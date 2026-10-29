// The rules of the benchmark card, kept free of the DOM so they can be tested.
// A row is {system, value, score, measured?, total?}: `value` is the figure bench shows (GB/s,
// MB/s, ms, s, ×), and `score` is bench's own published geomean ratio for that system. `measured`
// and `total` are bench's coverage: the datasets or queries the system ran, of all of them. The
// big figure comes from the scores, so the card never claims a ratio bench does not publish.
// Types: benchmark-card.d.ts.

const isOurs = (system) => String(system).toLowerCase() === "vortex";
const find = (rows, name) => rows.find((r) => String(r.system).toLowerCase() === name);

/**
 * Whether a row is measured: it has a value, and bench ran it on the whole workload. Bench ranks
 * a system it ran on only part of the workload (`measured < total`), but that total is not the
 * same workload as the others', so the card shows the row as "Not measured".
 */
const isMeasured = (r) =>
  Number.isFinite(r?.value) && !(Number.isFinite(r.measured) && Number.isFinite(r.total) && r.measured < r.total);

/**
 * A value as bench prints it in `unit`: two places for GB/s, ms and s ("52.80"), a whole number
 * with no grouping for MB/s ("2127"), and three significant figures with no trailing zeros for ×
 * ("1.07", "1"). Any other unit takes two places.
 */
export function formatValue(value, unit) {
  if (unit === "MB/s") return value.toFixed(0);
  if (unit === "×") return String(Number(value.toPrecision(3)));
  return value.toFixed(2);
}

/**
 * One panel's rows, best first. Each row is {system, value, width, label, ours}: `width` is the
 * value as a percentage of the panel's largest value (0 when missing), so in a lower-is-better
 * panel the best system has the shortest bar. `label` is the value as bench prints it in `unit`,
 * or "Not measured". A row with no value, or measured on only part of the workload, keeps its
 * place at the end with value null, so its absence never reads as zero.
 */
export function panelRows(rows, better, unit) {
  const measured = rows.filter(isMeasured);
  const missing = rows.filter((r) => !isMeasured(r));
  measured.sort((a, b) => (better === "higher" ? b.value - a.value : a.value - b.value));
  const max = Math.max(...measured.map((r) => r.value), 0);
  return [
    ...measured.map((r) => ({ system: r.system, value: r.value, width: max ? (r.value / max) * 100 : 0, label: formatValue(r.value, unit), ours: isOurs(r.system) })),
    ...missing.map((r) => ({ system: r.system, value: null, width: 0, label: "Not measured", ours: isOurs(r.system) })),
  ];
}

/**
 * Vortex against Parquet: {factor, vortexWins, estimated, missing}. `factor` is at least 1 and
 * says how far apart they are, `vortexWins` says which way. Both use bench's published scores when
 * the two rows have them, and otherwise the values, with `estimated: true`. When Vortex or
 * Parquet is not measured (see `panelRows`), `factor` and `vortexWins` are null and `missing`
 * names the one that is, Vortex first. Otherwise `missing` is null.
 */
export function versusParquet(rows, better) {
  const v = find(rows, "vortex");
  const p = find(rows, "parquet");
  const ok = (x) => Number.isFinite(x) && x > 0;
  const published = ok(v?.score) && ok(p?.score);
  if (!isMeasured(v) || !isMeasured(p)) return { factor: null, vortexWins: null, estimated: !published, missing: isMeasured(v) ? "Parquet" : "Vortex" };
  const [a, b] = published ? [v.score, p.score] : [v.value, p.value];
  if (!ok(a) || !ok(b)) return { factor: null, vortexWins: null, estimated: !published, missing: ok(a) ? "Parquet" : "Vortex" };
  const vortexWins = better === "higher" ? a > b : a < b;
  return { factor: Math.max(a / b, b / a), vortexWins, estimated: !published, missing: null };
}

/** A factor as the card prints it: 32× from 10 up, 5.1× from 1.1 up, 1.07× below, — for none. */
export function formatFactor(f) {
  if (!Number.isFinite(f)) return "—";
  if (Number(f.toFixed(1)) >= 10) return `${Math.round(f)}×`;
  if (f >= 1.1) return `${f.toFixed(1)}×`;
  // Two places below 1.1, without a trailing zero (1.096 reads 1.1×, not 1.10×).
  return `${f.toFixed(2).replace(/0$/, "")}×`;
}

/** The words beside the factor. `kind` is "speed" (time or throughput) or "size". */
export function panelNote(kind, { vortexWins, estimated, missing }) {
  if (vortexWins === null || vortexWins === undefined) return `${missing ?? "Vortex"} not measured`;
  const words = kind === "size" ? (vortexWins ? "smaller" : "larger") : vortexWins ? "faster" : "slower";
  return `${words} than Parquet${estimated ? " (estimated)" : ""}`;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

/**
 * One panel's markup. A panel is {title, unit, kind, better, rows}: the metric's name, its unit
 * (it keeps its case), "speed" or "size", "higher" or "lower", and the rows. The unit and the
 * direction share a line, so a long name never strands the arrow. Write a title whose parts a
 * line can break between ("Random access, NVMe, cold"). The CSS reserves two lines for it.
 */
export function renderPanel({ title, unit, kind, better, rows }) {
  const vs = versusParquet(rows, better);
  const arrow = better === "higher" ? "↑" : "↓";
  const bars = panelRows(rows, better, unit)
    .map((r) => {
      const fill = r.value === null ? "" : `<span class="vx-bar-fill" style="width:${Math.max(1.5, r.width)}%"></span>`;
      return `<div class="vx-bar${r.ours ? " is-ours" : ""}"><span>${esc(r.system)}</span><span class="vx-bar-track">${fill}</span><span class="vx-bar-value">${esc(r.label)}</span></div>`;
    })
    .join("");
  const head = `<div class="vx-label-sm vx-bench-title"><span class="vx-bench-metric">${esc(title)}</span><span class="vx-bench-unit"><span class="vx-keep-case">${esc(unit)}</span> ${arrow}</span></div>`;
  return `<div class="vx-bench-panel">${head}<div class="vx-stat vx-bench-big">${formatFactor(vs.factor)}<span class="vx-caption vx-bench-note">${esc(panelNote(kind, vs))}</span></div><div class="vx-bars">${bars}</div></div>`;
}
