// Types for the design system's ascii-core.js, from its JSDoc.

/** Characters from empty to dense, mapped from luminance 0..1. */
export const RAMP: string;

export function rampChar(v: number): string;

export function falloff(d: number, reach: number, core?: number): number;

export function brushStrength(
  cx: number,
  cy: number,
  marks: readonly { x: number; y: number; reach: number; k: number }[]
): number;

export function hexDigit(row: number, col: number, tick: number): string;

/** How many copies of a logo set the banner needs so that two loops cover the view, always even. */
export function copiesNeeded(setWidth: number, viewWidth: number): number;

/** The tokens the mark draws with in a colour scheme: four inks, the field's dot and the brush. */
export function markPalette(scheme: string): {
  inks: string[];
  field: string;
  brush: [string, string];
};

/**
 * Reads the mark's render back without stalling the GPU every frame: the first
 * frame after `resize` reads at once, then one async read is in flight at a time.
 */
export function frameReader(gpu: {
  render: () => void;
  readSync: (buf: Uint8Array) => void;
  readAsync?: ((buf: Uint8Array) => Promise<unknown>) | null;
}): { resize(bytes: number): void; next(): Uint8Array };
