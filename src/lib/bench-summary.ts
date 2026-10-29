import { formatDay } from "./date";

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
};

// The six panels, in the card's order, and where bench keeps each one.
const SOURCES: Source[] = [
  {
    title: "Scan throughput",
    unit: "× Parquet",
    kind: "speed",
    better: "higher",
    group: "Compression",
    rankings: (s) => s.rankings,
    name: (f) => f,
    where: { operation: "decode" },
    score: "ratio"
  },
  {
    title: "Random access, NVMe, cold",
    unit: "× fastest",
    kind: "speed",
    better: "lower",
    group: "Random Access (NVMe)",
    rankings: (s) => s.coldRankings,
    name: (f) => f,
    score: "score"
  },
  {
    title: "Random access, S3, cold",
    unit: "× fastest",
    kind: "speed",
    better: "lower",
    group: "Random Access (S3)",
    rankings: (s) => s.coldRankings,
    name: (f) => f,
    score: "score"
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
    score: "ratio"
  },
  {
    title: "ClickBench on DataFusion",
    unit: "× fastest",
    kind: "speed",
    better: "lower",
    group: "Clickbench",
    rankings: (s) => s.rankings,
    name: (f) => `datafusion:${f}`,
    score: "score"
  },
  {
    title: "File size against Parquet + zstd",
    unit: "×",
    kind: "size",
    better: "lower",
    group: "Compression Size",
    rankings: (s) => s.rankings,
    name: (f) => f,
    score: "ratio"
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
 * The BenchmarkCard's six panels from bench's `/api/groups` payload (its
 * `groups` array). Each panel lists Vortex, Parquet and Lance. A system bench
 * did not report keeps its row with no score, so the card says "Not
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
    if (rows.every((r) => !measured(r))) return null;
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
