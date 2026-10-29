// Types for benchmark-card.js. Copy this file beside the module, so TypeScript reads it.

export type BenchRow = {
  system: string;
  /** The figure bench shows, or null when bench did not measure it. */
  value: number | null;
  /** Bench's published geomean ratio for the system. */
  score?: number | null;
  /** The datasets or queries bench ran the system on. Below `total`, the row is "Not measured". */
  measured?: number | null;
  /** All the datasets or queries in the benchmark. */
  total?: number | null;
};

export type BenchPanel = {
  /** The metric's name, with parts a line can break between: "Random access, NVMe, cold". */
  title: string;
  /** The value's unit. It keeps its case, and sets how values print (see formatValue). */
  unit: string;
  kind: "speed" | "size";
  better: "higher" | "lower";
  rows: readonly BenchRow[];
};

export type PanelRow = {
  system: string;
  /** The value, or null when it is not measured. */
  value: number | null;
  /** The value as a percentage of the panel's largest, 0 when not measured. */
  width: number;
  /** The value as bench prints it, or "Not measured". */
  label: string;
  ours: boolean;
};

export type Versus = {
  /** At least 1, or null when Vortex or Parquet is not measured. */
  factor: number | null;
  vortexWins: boolean | null;
  estimated: boolean;
  /** The system that is not measured, Vortex first, or null when both are. */
  missing: "Vortex" | "Parquet" | null;
};

export function formatValue(value: number, unit: string): string;

export function panelRows(
  rows: readonly BenchRow[],
  better: BenchPanel["better"],
  unit?: string
): PanelRow[];

export function versusParquet(
  rows: readonly BenchRow[],
  better: BenchPanel["better"]
): Versus;

export function formatFactor(f: number | null): string;

export function panelNote(
  kind: BenchPanel["kind"],
  vs: Pick<Versus, "vortexWins" | "estimated"> & Partial<Pick<Versus, "missing">>
): string;

export function renderPanel(panel: BenchPanel): string;
