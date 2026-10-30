import type { Panel } from "./bench-summary";
import { geomean } from "./geomean";

/**
 * The BenchmarkCard's GPU panel. Bench does not publish a GPU benchmark yet,
 * so this one result is MAINTAINED BY HAND.
 *
 * Source: Will Manning's measurements, shown in the Vortex UW–Madison talk
 * deck, slide "Vortex in cuDF (end-to-end)". Do not link the deck from the
 * site.
 *
 * What it measures: query time end to end (read and query), with Vortex and
 * Parquet both in cuDF, on a GH200 480GB with the latest cuDF. The workload
 * is NDS-H at scale factor 10, all five queries cuDF runs. Each time is the
 * mean of the runs in ms, with a hot cache. Cold results exist but are not
 * shown. Parquet ran in four configurations: PyArrow's writer with zstd(3)
 * and with Snappy, and cuDF's writer with Snappy and 1M- or 4M-row groups.
 * Parquet's time for a query is the fastest of the four.
 *
 * The card shows each system's geomean time over the five queries, as it
 * does for bench's time panels: Vortex 17.00 ms, Parquet 65.88 ms, so Vortex
 * is 3.9× faster (the talk's geomean of per-query speedups, 3.875). Lance
 * has no cuDF integration, so its row is N/A (it cannot run, which is not
 * the same as "Not measured"). Arrow is not shown.
 *
 * To update: change the times in `GPU_QUERIES` (and `PARQUET_CONFIGS` if the
 * configurations change). The panel computes its geomeans from them. Change
 * `source.note` if the hardware, scale factor or source changes. Keep the
 * note short: the card prints it under the panels as "GPU analytics with
 * cuDF: <note>". If cuDF gains a Lance integration, give Lance its times in
 * the table and a row computed like Vortex's.
 */
export const PARQUET_CONFIGS = [
  "PyArrow, zstd(3)",
  "PyArrow, Snappy",
  "cuDF, Snappy, 1M-row groups",
  "cuDF, Snappy, 4M-row groups"
] as const;

/** Mean query time in ms, hot: Vortex, then Parquet in `PARQUET_CONFIGS` order. */
export const GPU_QUERIES: readonly {
  query: string;
  vortex: number;
  parquet: readonly [number, number, number, number];
}[] = [
  { query: "Q1", vortex: 32.37, parquet: [106.6, 97.96, 89.87, 82.28] },
  { query: "Q5", vortex: 13.27, parquet: [104.3, 82.99, 69.44, 61.04] },
  { query: "Q6", vortex: 8.54, parquet: [54.25, 49.35, 42.98, 41.39] },
  { query: "Q9", vortex: 17.03, parquet: [130.82, 106.11, 91.16, 77.84] },
  { query: "Q10", vortex: 22.73, parquet: [148.68, 111.51, 83.76, 76.7] }
];

/** Each system's geomean time in ms over the queries, Parquet at its fastest per query. */
export function gpuTimes(queries: typeof GPU_QUERIES) {
  return {
    vortex: geomean(queries.map((q) => q.vortex)),
    parquet: geomean(queries.map((q) => Math.min(...q.parquet)))
  };
}

const times = gpuTimes(GPU_QUERIES);

export const GPU_PANEL: Panel = {
  title: "GPU analytics with cuDF",
  unit: "ms",
  kind: "speed",
  better: "lower",
  rows: [
    { system: "Vortex", score: times.vortex },
    { system: "Parquet", score: times.parquet },
    { system: "Lance", score: null, unavailable: "no cuDF integration" }
  ],
  systems: ["Vortex", "Parquet", "Lance"],
  source: {
    note: "end to end, hot, on GH200, NDS-H SF10, Parquet the fastest of four configurations per query, from the Vortex UW–Madison talk"
  }
};
