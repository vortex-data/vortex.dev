// Types for cover.js, shipped beside it.

export interface CoverOptions {
  /** The cover's width in px, a multiple of 24. Default 960. */
  width?: number;
  /** The cover's height in px, a multiple of 24. Default 240. */
  height?: number;
  /** The px from the left kept empty for a title. Default 0. */
  clear?: number;
}

export interface CoverBlock {
  role: "slab" | "edge" | "muted";
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CoverChar {
  /** The centre of the character's 24px cell. */
  x: number;
  y: number;
  ch: string;
}

export interface CoverLayout {
  width: number;
  height: number;
  pitch: number;
  /** Drawn in order: the slab is last, over the others. */
  blocks: CoverBlock[];
  chars: CoverChar[];
  pattern: "fall" | "rise" | "sweep" | "diagonal" | "ripple" | "wave" | "terrace";
  slabPlace: "left" | "centre-left" | "centre-right" | "right";
  slabReach: "full" | "hang" | "stand";
  edgeSide: "left" | "right";
}

/** The ASCII mark's luminance ramp, from empty to full. */
export const COVER_RAMP: string;

export function coverLayout(seed: string, opts?: CoverOptions): CoverLayout;

/** The cover as SVG markup, coloured by bundle.css's vx-cover-* rules. */
export function coverFor(seed: string, opts?: CoverOptions): string;
