import { formatDay } from "./date";
import { geomean } from "./geomean";
import { GPU_PANEL } from "./gpu-result";

const GROUPS_URL = "https://bench.vortex.dev/api/groups";
const GROUP_URL = "https://bench.vortex.dev/api/group/";
// The commits a group's charts load. Each system's latest time per query is
// in the last few commits, and a short window keeps the payload small.
const WINDOW = 20;
const DAY_SECONDS = 86400;
const TIMEOUT_MS = 5000;

/**
 * One system in a panel: its time in ms (a time panel) or bench's published
 * geomean ratio to Parquet, and how many of the benchmark's datasets or
 * queries it ran, when known.
 */
export type Row = {
  system: string;
  score: number | null;
  measured?: number;
  total?: number;
  /** Why the system cannot run the benchmark at all; the card says N/A. */
  unavailable?: string;
};

/** One panel of the BenchmarkCard, as `benchmark-card.js` reads it. */
export type Panel = {
  title: string;
  unit: string;
  kind: "speed" | "size";
  better: "higher" | "lower";
  rows: Row[];
  /** The systems the panel shows, in order (`pickSystems`). */
  systems?: readonly string[];
  /** For figures that are not bench's: their source, printed under the panels. */
  source?: { note: string };
};

export type BenchSummary = { panels: Panel[]; readAt: Date };

// The systems the card can compare, by bench's format name, in the order the
// rows are listed (the card sorts them best first). Each panel chooses the
// ones it shows (`systems`). Bench runs Arrow (as Arrow IPC files) only in
// random access and file size.
const SYSTEMS = [
  ["Vortex", "vortex-file-compressed"],
  ["Parquet", "parquet"],
  ["Lance", "lance"],
  ["Arrow", "arrow-ipc"]
] as const;
const WITH_LANCE = ["Vortex", "Parquet", "Lance"];
const WITH_ARROW = ["Vortex", "Parquet", "Lance", "Arrow"];

type Ranking = Record<string, unknown>;

// The card's big figure and bars read the same numbers, so the bars show
// what the figure measures (Charts.md). A throughput or size panel shows
// bench's published geomean ratio to Parquet. A time panel shows each
// system's geomean time in ms over the same queries (for random access, the
// same datasets) as bench's score, from the latest per-query times in the
// group's charts. Bench's score is the geomean of each time against the
// fastest series, so Parquet's time over Vortex's is bench's score ratio, and
// each time is checked against it. benchmark-card.js prints the values as
// bench does.

type Source = {
  title: string;
  /** What the scores are measured against. */
  unit: string;
  kind: Panel["kind"];
  better: Panel["better"];
  group: string;
  /** The rankings that list the systems, from the group's summary. */
  rankings: (summary: Ranking) => unknown;
  /** The ranking's name for a system's format. */
  name: (format: string) => string;
  /** Extra fields a ranking must match, as the compression group's operation. */
  where?: Ranking;
  /** The ranking's field that holds the score. */
  score: "score" | "ratio";
  /** The systems the panel shows. */
  systems: readonly string[];
  /**
   * For a time panel: the series in the group's charts that holds a
   * system's times, and the bucket bench's score puts a chart in (a query
   * for ClickBench, a dataset for random access, where a dataset's time is
   * the sum of its charts').
   */
  times?: {
    series: (format: string) => string;
    bucket: (chart: string) => string;
  };
};

// The six panels, in the card's order: five from bench and, beside
// ClickBench, the GPU result bench does not publish yet, kept by hand in
// gpu-result.ts with its source.
const SOURCES: (Source | Panel)[] = [
  {
    title: "Scan throughput",
    unit: "× Parquet",
    kind: "speed",
    better: "higher",
    group: "Compression",
    rankings: (s) => s.rankings,
    name: (f) => f,
    where: { operation: "decode" },
    score: "ratio",
    systems: WITH_LANCE
  },
  {
    title: "Write throughput",
    unit: "× Parquet",
    kind: "speed",
    better: "higher",
    group: "Compression",
    rankings: (s) => s.rankings,
    name: (f) => f,
    where: { operation: "encode" },
    score: "ratio",
    systems: WITH_LANCE
  },
  {
    title: "ClickBench on DataFusion",
    unit: "ms",
    kind: "speed",
    better: "lower",
    group: "Clickbench",
    rankings: (s) => s.rankings,
    name: (f) => `datafusion:${f}`,
    score: "score",
    systems: WITH_LANCE,
    times: { series: (f) => `datafusion:${f}`, bucket: (chart) => chart }
  },
  GPU_PANEL,
  {
    title: "Random access, NVMe, cold",
    unit: "ms",
    kind: "speed",
    better: "lower",
    group: "Random Access (NVMe)",
    rankings: (s) => s.coldRankings,
    name: (f) => f,
    score: "score",
    systems: WITH_ARROW,
    // Bench sums a dataset's charts ("taxi", "taxi/correlated",
    // "taxi/uniform") into one time per dataset.
    times: {
      series: (f) => `${f}:cold`,
      bucket: (chart) => chart.split("/")[0] ?? chart
    }
  },
  {
    title: "File size against Parquet + zstd",
    unit: "×",
    kind: "size",
    better: "lower",
    group: "Compression Size",
    rankings: (s) => s.rankings,
    name: (f) => f,
    score: "ratio",
    systems: WITH_ARROW
  }
];

const isObject = (x: unknown): x is Ranking =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const positive = (x: unknown): x is number =>
  typeof x === "number" && Number.isFinite(x) && x > 0;
const count = (x: unknown) =>
  typeof x === "number" && Number.isInteger(x) && x >= 0 ? x : undefined;

// Whether bench ran the system on the whole workload, as benchmark-card.js
// decides it.
const measured = (r: Row) =>
  r.score !== null &&
  !(r.measured !== undefined && r.total !== undefined && r.measured < r.total);

// Bench's coverage passes through: benchmark-card.js shows a system measured
// on only part of the workload as "Not measured".
function rowFor(source: Source, rankings: Ranking[], format: string) {
  const name = source.name(format);
  const where = Object.entries(source.where ?? {});
  const r = rankings.find(
    (x) => x.name === name && where.every(([k, v]) => x[k] === v)
  );
  if (!r) return { score: null };
  const score = r[source.score];
  const measured = count(r.measured);
  const total = count(r.total);
  return {
    score: positive(score) ? score : null,
    ...(measured === undefined ? {} : { measured }),
    ...(total === undefined ? {} : { total })
  };
}

// The latest positive value in a series, or undefined.
function latest(values: unknown): number | undefined {
  if (!Array.isArray(values)) return undefined;
  for (let i = values.length - 1; i >= 0; i--)
    if (positive(values[i])) return values[i];
  return undefined;
}

/**
 * Each series' geomean time in ms, from a group's charts (`/api/group`), as
 * bench's score takes them: the latest time per chart, summed per bucket. A
 * bucket counts when some series has a time for it, and a series has a time
 * for a bucket only when it has one for each of the bucket's charts.
 * `measured` and `total` count the buckets. `null` when the payload is not
 * bench's shape or its times are not in nanoseconds.
 */
export function groupTimes(
  payload: unknown,
  bucket: (chart: string) => string
): Map<string, { ms: number | null; measured: number; total: number }> | null {
  const charts = isObject(payload) ? payload.charts : undefined;
  if (!Array.isArray(charts)) return null;
  const buckets = new Map<string, Ranking[]>();
  for (const c of charts) {
    if (!isObject(c) || typeof c.name !== "string" || !isObject(c.series))
      return null;
    if (c.unit_kind !== "time_ns") return null;
    const series = c.series;
    if (!Object.values(series).some((v) => latest(v) !== undefined)) continue;
    const key = bucket(c.name);
    buckets.set(key, [...(buckets.get(key) ?? []), series]);
  }
  const names = new Set(
    [...buckets.values()].flat().flatMap((series) => Object.keys(series))
  );
  const out = new Map<
    string,
    { ms: number | null; measured: number; total: number }
  >();
  for (const name of names) {
    const sums: number[] = [];
    for (const list of buckets.values()) {
      const times = list.map((series) => latest(series[name]));
      if (times.every((t) => t !== undefined))
        sums.push(times.reduce((a: number, t) => a + (t ?? 0), 0));
    }
    const ns = geomean(sums);
    out.set(name, {
      ms: ns === null ? null : ns / 1e6,
      measured: sums.length,
      total: buckets.size
    });
  }
  return out;
}

// A time panel's rows: each system's geomean time in ms, where bench scores
// the system. The panel's factor is Parquet's time over Vortex's, so the bars
// and the factor agree by construction. bench serves scores and charts from
// two endpoints that a build can read a commit apart, so the times are not
// held to the scores' ratios: that would blank a panel for a moment's drift.
function timeRows(
  source: Source & { times: NonNullable<Source["times"]> },
  rankings: Ranking[],
  times: NonNullable<ReturnType<typeof groupTimes>>
): Row[] {
  return SYSTEMS.map(([system, format]) => {
    const score = rowFor(source, rankings, format).score;
    const time = times.get(source.times.series(format));
    if (!time) return { system, score: null };
    const { ms, measured, total } = time;
    return { system, score: score === null ? null : ms, measured, total };
  });
}

/**
 * The BenchmarkCard's six panels: five from bench (its `/api/groups`
 * payload's `groups` array and, for a time panel, `charts`, its group's
 * `/api/group` payload by group name) and the hand-kept GPU panel. Each
 * bench panel has a row for every system the card knows and names the ones
 * it shows (`systems`). A shown system bench did not report keeps its row
 * with no score, so the card says "Not measured". A group that is missing,
 * or that reports none of the shown systems, gives `null`: the card shows six
 * panels or none.
 */
export function panelsFrom(
  groups: unknown,
  charts: Record<string, unknown> = {}
): Panel[] | null {
  if (!Array.isArray(groups)) return null;
  const panels: Panel[] = [];
  for (const source of SOURCES) {
    if (!("group" in source)) {
      panels.push(source);
      continue;
    }
    const group = groups.find((g) => isObject(g) && g.name === source.group);
    const summary = isObject(group) ? group.summary : undefined;
    const list = isObject(summary) ? source.rankings(summary) : undefined;
    if (!Array.isArray(list)) return null;
    const rankings = list.filter(isObject);
    const scoreRows = (): Row[] =>
      SYSTEMS.map(([system, format]) => ({
        system,
        ...rowFor(source, rankings, format)
      }));
    let rows = scoreRows();
    let { unit } = source;
    if (source.times) {
      // bench's chart window counts commits across the repository, so a
      // benchmark that has not run lately has no times in it although its
      // scores stand. Then the panel shows the scores, against the fastest,
      // and the card stays on the page.
      const times = groupTimes(charts[source.group], source.times.bucket);
      const timed = times
        ? timeRows({ ...source, times: source.times }, rankings, times)
        : null;
      const has = (name: string) =>
        timed?.some((r) => r.system === name && measured(r));
      if (timed && has("Vortex") && has("Parquet")) rows = timed;
      else unit = "× fastest";
    }
    const { title, kind, better, systems } = source;
    const shown = rows.filter((r) => systems.includes(r.system));
    if (shown.every((r) => !measured(r))) return null;
    panels.push({ title, unit, kind, better, rows, systems });
  }
  return panels;
}

/**
 * The homepage's benchmark figures, read from bench.vortex.dev at build time
 * and again at most once a day (ISR). A figure is never typed into the page.
 * It reads `/api/groups`, then the charts of each time panel's group
 * (`/api/group/{slug}`, the last `WINDOW` commits). `readAt` is the time
 * bench answered the first read (its Date header), so a cached answer keeps
 * its own date. Any failure (a timeout, an error status, a payload without
 * all six panels) gives `null`, and the page then leaves the card out. A
 * time panel whose charts are missing from the window shows bench's scores.
 * `fetchImpl` is for tests.
 */
export async function getBenchSummary(
  fetchImpl: typeof fetch = fetch
): Promise<BenchSummary | null> {
  const read = (url: string) =>
    fetchImpl(url, {
      next: { revalidate: DAY_SECONDS },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  try {
    const res = await read(GROUPS_URL);
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const groups = isObject(body) ? body.groups : undefined;
    if (!Array.isArray(groups)) return null;
    const slugs: [string, string][] = [];
    for (const source of SOURCES) {
      if (!("times" in source) || !source.times) continue;
      const group = groups.find((g) => isObject(g) && g.name === source.group);
      const slug = isObject(group) ? group.slug : undefined;
      if (typeof slug !== "string" || !/^[\w.-]+$/.test(slug)) return null;
      slugs.push([source.group, slug]);
    }
    const charts = Object.fromEntries(
      await Promise.all(
        slugs.map(async ([name, slug]) => {
          try {
            const r = await read(`${GROUP_URL}${slug}?n=${WINDOW}`);
            return [name, r.ok ? ((await r.json()) as unknown) : null] as const;
          } catch {
            // The panel shows bench's scores instead (panelsFrom).
            return [name, null] as const;
          }
        })
      )
    );
    const panels = panelsFrom(groups, charts);
    if (!panels) return null;
    const date = new Date(res.headers.get("date") ?? "");
    return {
      panels,
      readAt: Number.isNaN(date.getTime()) ? new Date() : date
    };
  } catch {
    return null;
  }
}

/** "28 Oct 2026", in UTC, for the card's source line. */
export function formatReadDate(d: Date): string {
  return formatDay(d);
}
