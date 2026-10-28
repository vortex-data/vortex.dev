// The rules of the ASCII mark and the logo banner, kept free of the DOM so they can be tested.

/** Characters from empty to dense, mapped from luminance 0..1. */
export const RAMP = " .:-=+*#%@";
const HEX = "0123456789abcdef";

/** The ramp character for luminance `v`, clamped to 0..1. */
export function rampChar(v) {
  const x = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
  return RAMP[Math.round(x * (RAMP.length - 1))];
}

/** 1 inside the solid core, 0 at and beyond `reach`, linear between. */
export function falloff(d, reach, core = 0.3) {
  const c = reach * core;
  if (d <= c) return 1;
  if (d >= reach) return 0;
  return 1 - (d - c) / (reach - c);
}

/** The strongest brush mark at cell centre (cx, cy). Each mark is {x, y, reach, k}. */
export function brushStrength(cx, cy, marks) {
  let s = 0;
  for (const m of marks) s = Math.max(s, falloff(Math.hypot(cx - m.x, cy - m.y), m.reach) * m.k);
  return s;
}

/** A hex digit for a cell that flickers with `tick`. Always one of 0-9a-f, for any integers. */
export function hexDigit(row, col, tick) {
  let h = Math.imul((row | 0) * 4096 + (col | 0), 2654435761) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  const speed = (h >>> 8) % 3 + 1;
  return HEX[(((h + Math.imul(tick | 0, speed)) >>> 0) % 16)];
}

/** How many copies of a logo set the banner needs so that two loops cover the view, always even. */
export function copiesNeeded(setWidth, viewWidth) {
  const n = Math.max(2, Math.ceil((2 * viewWidth) / Math.max(1, setWidth)));
  return n % 2 ? n + 1 : n;
}

/**
 * The camera's vertical field of view (degrees) for a host of `aspect` (width / height). The mark
 * is framed for a square: a wide host keeps `base` and shows more around it, and a tall host opens
 * the vertical field until the horizontal one equals `base`, so the mark's sides are never cropped.
 */
export function fitFov(base, aspect) {
  if (aspect >= 1) return base;
  return (2 * Math.atan(Math.tan((base * Math.PI) / 360) / aspect) * 180) / Math.PI;
}
