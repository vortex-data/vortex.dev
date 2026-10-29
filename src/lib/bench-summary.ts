import { formatDay } from "./date";
import { GPU_PANEL } from "./gpu-result";

const GROUPS_URL = "https://bench.vortex.dev/api/groups";
const DAY_SECONDS = 86400;
const TIMEOUT_MS = 5000;

/**
 * One system in a panel: bench's published geomean score, and how many of
 * the benchmark's datasets or queries bench ran it on, when bench says.
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

// The card claims bench's score and nothing else: its big figure is
// Parquet's score against Vortex's, and its bars are the three scores, so
// the bars show what the figure measures (Charts.md). A timing score is the
// geomean of a system's time against the fastest series on bench; a
// throughput or size score is the geomean ratio to Parquet. Scores stay as
// bench publishes them, and benchmark-card.js prints them as bench does.

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
    unit: "× fastest",
    kind: "speed",
    better: "lower",
    group: "Clickbench",
    rankings: (s) => s.rankings,
    name: (f) => `datafusion:${f}`,
    score: "score",
    systems: WITH_LANCE
  },
  GPU_PANEL,
  {
    title: "Random access, NVMe, cold",
    unit: "× fastest",
    kind: "speed",
    better: "lower",
    group: "Random Access (NVMe)",
    rankings: (s) => s.coldRankings,
    name: (f) => f,
    score: "score",
    systems: WITH_ARROW
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

/**
 * The BenchmarkCard's six panels: five from bench's `/api/groups` payload
 * (its `groups` array) and the hand-kept GPU panel. Each bench panel has a
 * row for every system the card knows and names the ones it shows
 * (`systems`). A shown system bench did not report keeps its row with no
 * score, so the card says "Not measured". A group that is missing, or that
 * reports none of the shown systems, gives `null`: the card shows six panels
 * or none.
 */
export function panelsFrom(groups: unknown): Panel[] | null {
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
    const rows = SYSTEMS.map(([system, format]) => ({
      system,
      ...rowFor(source, rankings, format)
    }));
    const { title, unit, kind, better, systems } = source;
    const shown = rows.filter((r) => systems.includes(r.system));
    if (shown.every((r) => !measured(r))) return null;
    panels.push({ title, unit, kind, better, rows, systems });
  }
  return panels;
}

/**
 * The homepage's benchmark figures, read from bench.vortex.dev at build time
 * and again at most once a day (ISR). A figure is never typed into the page.
 * `readAt` is the time bench answered (its Date header), so a cached answer
 * keeps its own date. Any failure (a timeout, an error status, a payload
 * without all six panels) gives `null`, and the page then leaves the card
 * out. `fetchImpl` is for tests.
 */
export async function getBenchSummary(
  fetchImpl: typeof fetch = fetch
): Promise<BenchSummary | null> {
  try {
    const res = await fetchImpl(GROUPS_URL, {
      next: { revalidate: DAY_SECONDS },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const panels = panelsFrom(isObject(body) ? body.groups : undefined);
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
