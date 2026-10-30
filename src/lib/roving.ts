// One tab stop for a group of items: the arrow keys move the focus and the
// selection together, Home and End jump to the ends. A port of the design
// system's components/lib/roving.js.

export type Orientation = "horizontal" | "vertical";

const KEYS: Record<Orientation, Record<string, number>> = {
  vertical: { ArrowUp: -1, ArrowDown: 1 },
  horizontal: { ArrowLeft: -1, ArrowRight: 1 }
};

/** The item `key` moves to from `index` in a group of `count`, or null if the key does nothing. */
export function nextIndex(
  key: string,
  index: number,
  count: number,
  orientation: Orientation
): number | null {
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  const step = KEYS[orientation][key];
  if (!step) return null;
  return Math.min(count - 1, Math.max(0, index + step));
}
