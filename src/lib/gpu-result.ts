import type { Panel } from "./bench-summary";

/**
 * The BenchmarkCard's GPU panel. Bench does not publish a GPU benchmark yet,
 * so this one result is MAINTAINED BY HAND.
 *
 * Source: the Vortex UW–Madison talk deck, slide "Vortex in cuDF
 * (end-to-end)". Do not link the deck from the site.
 *
 * What it measures: query time end to end (read and query), hot, with
 * Vortex and Parquet both in cuDF, as Parquet's time divided by Vortex's.
 * Parquet's time per query is the fastest of four configurations (PyArrow
 * with zstd(3) and with Snappy, and cuDF with Snappy and 1M- or 4M-row
 * groups). The workload is NDS-H at scale factor 10, all five queries cuDF
 * runs (Q1 2.5×, Q5 4.6×, Q6 4.9×, Q9 4.6×, Q10 3.4×), on a GH200 480GB
 * with the latest cuDF. The geomean is 3.9×. The cold result (1.8×) is not
 * shown. Lance has no cuDF integration, so its row is N/A (it cannot run,
 * which is not the same as "Not measured"). Arrow is not shown.
 *
 * To update: change `score` for Vortex (Parquet stays 1, the fastest
 * Parquet configuration), `PER_QUERY`, and `source.note` if the hardware,
 * scale factor or source changes. Keep the note short: the card prints it
 * under the panels as "GPU analytics with cuDF: <note>". If cuDF gains a
 * Lance integration, replace Lance's `unavailable` with its score or remove
 * the row.
 */
export const GPU_PANEL: Panel = {
  title: "GPU analytics with cuDF",
  unit: "× Parquet",
  kind: "speed",
  better: "higher",
  rows: [
    { system: "Vortex", score: 3.9 },
    { system: "Parquet", score: 1 },
    { system: "Lance", score: null, unavailable: "no cuDF integration" }
  ],
  systems: ["Vortex", "Parquet", "Lance"],
  source: {
    note: "end to end, hot, on GH200, NDS-H SF10, from the Vortex UW–Madison talk"
  }
};

/** The talk's per-query speedups behind the 3.9× geomean, for reference. */
export const PER_QUERY = { Q1: 2.5, Q5: 4.6, Q6: 4.9, Q9: 4.6, Q10: 3.4 };
