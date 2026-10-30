// Types for benchmark-card.js. Copy this file beside the module, so TypeScript reads it.

export type BenchRow = {
  system: string;
  /**
   * The system's number in the panel, or null when it was not measured: in a time panel its geomean
   * time in ms over the queries bench's score covers, otherwise bench's geomean ratio to Parquet.
   */
  score: number | null;
  /** The datasets or queries bench ran the system on. Below `total`, the row is "Not measured". */
  measured?: number | null;
  /** All the datasets or queries in the benchmark. */
  total?: number | null;
  /**
   * Why the system cannot run the benchmark at all ("no cuDF integration"). The row is then "N/A".
   * "Not measured" is for a system that could run but has no result.
   */
  unavailable?: string;
};

export type BenchPanel = {
  /** The metric's name, with parts a line can break between: "Random access, NVMe, cold". */
  title: string;
  /** The scores' unit: "ms" for a time, "× Parquet" for a throughput ratio, "×" for file size. */
  unit: string;
  kind: "speed" | "size";
  better: "higher" | "lower";
  rows: readonly BenchRow[];
  /** The systems the panel shows, in order. It must name Vortex and Parquet. Omitted, every row shows. */
  systems?: readonly string[];
  /** For figures that are not bench's: where they come from, which the card prints under the panels. */
  source?: PanelSource;
};

export type PanelSource = {
  /** Where the figures come from, briefly: "end to end, hot, on GH200, NDS-H SF10". */
  note: string;
};

export type PanelRow = {
  system: string;
  /** The score, or null when it is not measured. */
  score: number | null;
  /** The score as a percentage of the panel's largest, 0 when not measured. */
  width: number;
  /** The score as bench prints it with a short unit ("42.25 ms", "5.12×"), "Not measured" or "N/A". */
  label: string;
  /** For screen readers and the hover title: "42.25 ms", "5.12× Parquet", "Not measured", or "not available, " and the reason. */
  exact: string;
  state: "measured" | "not-measured" | "n/a";
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

export function exactValue(score: number | null, unit: string): string;

export function pickSystems(
  rows: readonly BenchRow[],
  systems: readonly string[] | undefined
): BenchRow[];

export function panelRows(
  rows: readonly BenchRow[],
  better: BenchPanel["better"],
  unit: string
): PanelRow[];

/** The panel's value column: its longest value or "N/A", in ch ("9ch"). */
export function valueWidth(rows: readonly PanelRow[]): string;

export function versusParquet(
  rows: readonly BenchRow[],
  better: BenchPanel["better"]
): Versus;

export function formatFactor(f: number | null): string;

/** The big figure: a whole percentage below 2× ("57%"), a factor from 2× up ("5.1×"), "1×" when level, "—" when not measured. */
export function panelFactor(
  kind: BenchPanel["kind"],
  vs: Pick<Versus, "factor" | "vortexWins"> & Partial<Pick<Versus, "tie" | "missing">>
): string;

export function panelNote(
  kind: BenchPanel["kind"],
  vs: Pick<Versus, "vortexWins"> & Partial<Pick<Versus, "factor" | "tie" | "missing">>
): string;


export function renderPanel(panel: BenchPanel): string;

/** A bar row's class: `vx-bar` with `is-ours`, `is-parquet`, `is-lance`, `is-arrow`,
 * `is-missing` or `is-na` as they apply. */
export function barClass(row: Pick<PanelRow, "system" | "state" | "ours">): string;

/** The few words after the headline's dot, from the panels' units: "times in ms, ratios to Parquet, best first". */
export function benchCaption(panels: readonly Pick<BenchPanel, "unit">[]): string;

/** How each kind of value the panels show is made, for the caption's title and screen readers. */
export function benchMethod(panels: readonly Pick<BenchPanel, "unit">[]): string;
