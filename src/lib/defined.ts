/**
 * `value`, or an error when it is null or undefined. Use it where an index or
 * a lookup must find something (tests above all), in place of a non-null
 * assertion (`value!`), which fails later and with less to go on.
 */
export function defined<T>(value: T | null | undefined, what = "value"): T {
  if (value === null || value === undefined) {
    throw new Error(`expected ${what} to be defined, got ${value}`);
  }
  return value;
}
