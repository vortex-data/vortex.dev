// Types for the design system's benchmark-card.js, from its JSDoc.

export type BenchRow = {
  system: string;
  /** The figure bench shows, or null when bench did not measure it. */
  value: number | null;
  /** Bench's published geomean ratio for the system. */
  score?: number | null;
};

export type BenchPanel = {
  title: string;
  /** The value's unit. It keeps its case. */
  unit: string;
  kind: "speed" | "size";
  better: "higher" | "lower";
  rows: readonly BenchRow[];
};

export type PanelRow = {
  system: string;
  value: number | null;
  /** The value as a percentage of the panel's largest, 0 when missing. */
  width: number;
  /** The formatted value, or "Not measured". */
  label: string;
  ours: boolean;
};

export type Versus = {
  /** At least 1, or null without a Vortex or Parquet figure. */
  factor: number | null;
  vortexWins: boolean | null;
  estimated: boolean;
};

export function panelRows(
  rows: readonly BenchRow[],
  better: BenchPanel["better"]
): PanelRow[];

export function versusParquet(
  rows: readonly BenchRow[],
  better: BenchPanel["better"]
): Versus;

export function formatFactor(f: number | null): string;

export function panelNote(
  kind: BenchPanel["kind"],
  vs: Pick<Versus, "vortexWins" | "estimated">
): string;

export function renderPanel(panel: BenchPanel): string;
