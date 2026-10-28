import { formatDay } from "./date";

const GROUPS_URL = "https://bench.vortex.dev/api/groups";
const DAY_SECONDS = 86400;
const TIMEOUT_MS = 5000;

/** One system in a panel: the value bench shows and bench's geomean ratio. */
export type Row = {
  system: string;
  value: number | null;
  score: number | null;
};

/** One panel of the BenchmarkCard, as `benchmark-card.js` reads it. */
export type Panel = {
  title: string;
  unit: string;
  kind: "speed" | "size";
  better: "higher" | "lower";
  rows: Row[];
};

export type BenchSummary = { panels: Panel[]; readAt: Date };

// The three systems the card compares, by bench's format name, in the order
// the rows are listed (the card sorts them best first).
const SYSTEMS = [
  ["Vortex", "vortex-file-compressed"],
  ["Parquet", "parquet"],
  ["Lance", "lance"]
] as const;

type Ranking = Record<string, unknown>;

// Values are rounded as bench's own summary cards print them (SummaryCard and
// formatTimeNs in bench/web): two places for GB/s, ms and s, whole MB/s, and
// three significant figures for a size ratio. So every figure on the card is
// one a reader finds on bench. Scores stay as bench publishes them, because
// the card divides them for its factor and prints only the result.
const places = (n: number) => (x: number) => Number(x.toFixed(n));
const figures = (n: number) => (x: number) => Number(x.toPrecision(n));

type Source = {
  title: string;
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
  value: (r: Ranking) => unknown;
  score: (r: Ranking) => unknown;
  round: (x: number) => number;
};

const NS_PER_MS = 1e6;
const NS_PER_S = 1e9;
const ns = (r: Ranking, per: number) =>
  typeof r.totalRuntime === "number" ? r.totalRuntime / per : undefined;

// The six panels, in the card's order, and where bench keeps each one.
const SOURCES: Source[] = [
  {
    title: "Scan throughput",
    unit: "GB/s",
    kind: "speed",
    better: "higher",
    group: "Compression",
    rankings: (s) => s.rankings,
    name: (f) => f,
    where: { operation: "decode" },
    value: (r) => r.throughputGbS,
    score: (r) => r.ratio,
    round: places(2)
  },
  {
    title: "Random access · NVMe · cold",
    unit: "ms",
    kind: "speed",
    better: "lower",
    group: "Random Access (NVMe)",
    rankings: (s) => s.coldRankings,
    name: (f) => f,
    value: (r) => ns(r, NS_PER_MS),
    score: (r) => r.score,
    round: places(2)
  },
  {
    title: "Random access · S3 · cold",
    unit: "ms",
    kind: "speed",
    better: "lower",
    group: "Random Access (S3)",
    rankings: (s) => s.coldRankings,
    name: (f) => f,
    value: (r) => ns(r, NS_PER_MS),
    score: (r) => r.score,
    round: places(2)
  },
  {
    title: "Write throughput",
    unit: "MB/s",
    kind: "speed",
    better: "higher",
    group: "Compression",
    rankings: (s) => s.rankings,
    name: (f) => f,
    where: { operation: "encode" },
    value: (r) =>
      typeof r.throughputGbS === "number" ? r.throughputGbS * 1000 : undefined,
    score: (r) => r.ratio,
    round: places(0)
  },
  {
    title: "ClickBench on DataFusion",
    unit: "s",
    kind: "speed",
    better: "lower",
    group: "Clickbench",
    rankings: (s) => s.rankings,
    name: (f) => `datafusion:${f}`,
    value: (r) => ns(r, NS_PER_S),
    score: (r) => r.score,
    round: places(2)
  },
  {
    title: "File size against Parquet + zstd",
    unit: "×",
    kind: "size",
    better: "lower",
    group: "Compression Size",
    rankings: (s) => s.rankings,
    name: (f) => f,
    value: (r) => r.ratio,
    score: (r) => r.ratio,
    round: figures(3)
  }
];

const isObject = (x: unknown): x is Ranking =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const positive = (x: unknown): x is number =>
  typeof x === "number" && Number.isFinite(x) && x > 0;

// A system that bench measured on only some of a group's datasets or queries
// did not run the same workload as the others, so the card shows it as not
// measured rather than set a partial total beside full ones (Charts.md).
const complete = (r: Ranking) =>
  !(typeof r.measured === "number" && typeof r.total === "number") ||
  (r.measured > 0 && r.measured >= r.total);

function rowFor(source: Source, rankings: Ranking[], format: string) {
  const name = source.name(format);
  const where = Object.entries(source.where ?? {});
  const r = rankings.find(
    (x) => x.name === name && where.every(([k, v]) => x[k] === v)
  );
  if (!r || !complete(r)) return { value: null, score: null };
  const value = source.value(r);
  const score = source.score(r);
  return {
    value: positive(value) ? source.round(value) : null,
    score: positive(score) ? score : null
  };
}

/**
 * The BenchmarkCard's six panels from bench's `/api/groups` payload (its
 * `groups` array). Each panel lists Vortex, Parquet and Lance. A system bench
 * did not report keeps its row with no value, so the card says "Not
 * measured". A group that is missing, or that reports none of the three, gives
 * `null`: the card shows six panels or none.
 */
export function panelsFrom(groups: unknown): Panel[] | null {
  if (!Array.isArray(groups)) return null;
  const panels: Panel[] = [];
  for (const source of SOURCES) {
    const group = groups.find((g) => isObject(g) && g.name === source.group);
    const summary = isObject(group) ? group.summary : undefined;
    const list = isObject(summary) ? source.rankings(summary) : undefined;
    if (!Array.isArray(list)) return null;
    const rankings = list.filter(isObject);
    const rows = SYSTEMS.map(([system, format]) => ({
      system,
      ...rowFor(source, rankings, format)
    }));
    if (rows.every((r) => r.value === null)) return null;
    const { title, unit, kind, better } = source;
    panels.push({ title, unit, kind, better, rows });
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
