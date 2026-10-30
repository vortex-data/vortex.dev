/**
 * The geometric mean of positive, finite numbers, taken in log space as
 * bench takes its own (`exp(mean(ln v))`), or `null` when there are none or
 * any value is not positive and finite.
 */
export function geomean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const v of values) {
    if (!(Number.isFinite(v) && v > 0)) return null;
    sum += Math.log(v);
  }
  return Math.exp(sum / values.length);
}
