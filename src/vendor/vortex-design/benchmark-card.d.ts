// Types for benchmark-card.js. Copy this file beside the module, so TypeScript reads it.

export type BenchRow = {
  system: string;
  /** Bench's published geomean score for the system, or null when bench did not measure it. */
  score: number | null;
  /** The datasets or queries bench ran the system on. Below `total`, the row is "Not measured". */
  measured?: number | null;
  /** All the datasets or queries in the benchmark. */
  total?: number | null;
};

export type BenchPanel = {
  /** The metric's name, with parts a line can break between: "Random access, NVMe, cold". */
  title: string;
  /** What the scores are measured against: "× fastest", "× Parquet", or "×" for file size. */
  unit: string;
  kind: "speed" | "size";
  better: "higher" | "lower";
  rows: readonly BenchRow[];
};

export type PanelRow = {
  system: string;
  /** The score, or null when it is not measured. */
  score: number | null;
  /** The score as a percentage of the panel's largest, 0 when not measured. */
  width: number;
  /** The score as bench prints it, or "Not measured". */
  label: string;
  ours: boolean;
};

export type Versus = {
  /** Parquet's score against Vortex's, at least 1, or null when either is not measured. */
  factor: number | null;
  vortexWins: boolean | null;
  /** Whether the scores are equal (then `factor` is 1 and `vortexWins` false), or null when either is not measured. */
  tie: boolean | null;
  /** The system that is not measured, Vortex first, or null when both are. */
  missing: "Vortex" | "Parquet" | null;
};

export function formatScore(score: number, unit: string): string;

export function panelRows(
  rows: readonly BenchRow[],
  better: BenchPanel["better"],
  unit: string
): PanelRow[];

export function versusParquet(
  rows: readonly BenchRow[],
  better: BenchPanel["better"]
): Versus;

export function formatFactor(f: number | null): string;

export function panelNote(
  kind: BenchPanel["kind"],
  vs: Pick<Versus, "vortexWins"> & Partial<Pick<Versus, "tie" | "missing">>
): string;

export function renderPanel(panel: BenchPanel): string;
