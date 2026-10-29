// The rules of the benchmark card, kept free of the DOM so they can be tested.
// A row is {system, score, measured?, total?}: `score` is bench's own published geomean for that
// system (a time ratio to the fastest series, or a throughput or size ratio to Parquet), and
// `measured` and `total` are bench's coverage: the datasets or queries the system ran, of all of
// them. The bars and the big figure both read the scores, so they always agree, and the card never
// claims a ratio bench does not publish.
// Types: benchmark-card.d.ts.

const isOurs = (system) => String(system).toLowerCase() === "vortex";
const find = (rows, name) => rows.find((r) => String(r.system).toLowerCase() === name);

/**
 * Whether a row is measured: it has a score, and bench ran it on the whole workload. Bench scores
 * a system it ran on only part of the workload (`measured < total`) with a penalty for the rest,
 * which is not the same workload as the others', so the card shows the row as "Not measured".
 */
const isMeasured = (r) =>
  Number.isFinite(r?.score) && r.score > 0 && !(Number.isFinite(r.measured) && Number.isFinite(r.total) && r.measured < r.total);

/**
 * A score as bench prints it: three significant figures with no trailing zeros for the file-size
 * ratio, whose unit is a bare "×" ("1.07", "1"), and two places for every other score ("38.20").
 */
export function formatScore(score, unit) {
  if (unit === "×") return String(Number(score.toPrecision(3)));
  return score.toFixed(2);
}

/**
 * One panel's rows, best first. Each row is {system, score, width, label, ours}: `width` is the
 * score as a percentage of the panel's largest (0 when missing), so in a lower-is-better panel the
 * best system has the shortest bar. `label` is the score as bench prints it, or "Not measured". A
 * row with no score, or measured on only part of the workload, keeps its place at the end with
 * score null, so its absence never reads as zero.
 */
export function panelRows(rows, better, unit) {
  const measured = rows.filter(isMeasured);
  const missing = rows.filter((r) => !isMeasured(r));
  measured.sort((a, b) => (better === "higher" ? b.score - a.score : a.score - b.score));
  const max = Math.max(...measured.map((r) => r.score), 0);
  return [
    ...measured.map((r) => ({ system: r.system, score: r.score, width: max ? (r.score / max) * 100 : 0, label: formatScore(r.score, unit), ours: isOurs(r.system) })),
    ...missing.map((r) => ({ system: r.system, score: null, width: 0, label: "Not measured", ours: isOurs(r.system) })),
  ];
}

/**
 * Vortex against Parquet: {factor, vortexWins, missing}. `factor` is the ratio of their scores,
 * at least 1, and says how far apart they are; `vortexWins` says which way. When Vortex or
 * Parquet is not measured (see `panelRows`), `factor` and `vortexWins` are null and `missing`
 * names the one that is, Vortex first. Otherwise `missing` is null.
 */
export function versusParquet(rows, better) {
  const v = find(rows, "vortex");
  const p = find(rows, "parquet");
  if (!isMeasured(v) || !isMeasured(p)) return { factor: null, vortexWins: null, missing: isMeasured(v) ? "Parquet" : "Vortex" };
  const vortexWins = better === "higher" ? v.score > p.score : v.score < p.score;
  return { factor: Math.max(v.score / p.score, p.score / v.score), vortexWins, missing: null };
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
export function panelNote(kind, { vortexWins, missing }) {
  if (vortexWins === null || vortexWins === undefined) return `${missing ?? "Vortex"} not measured`;
  const words = kind === "size" ? (vortexWins ? "smaller" : "larger") : vortexWins ? "faster" : "slower";
  return `${words} than Parquet`;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

/**
 * One panel's markup. A panel is {title, unit, kind, better, rows}: the metric's name, what its
 * scores are measured against ("× fastest", "× Parquet", or "×" for the file-size ratio; it keeps
 * its case), "speed" or "size", "higher" or "lower", and the rows. The unit and the
 * direction share a line, so a long name never strands the arrow. Write a title whose parts a
 * line can break between ("Random access, NVMe, cold"). The CSS reserves two lines for it.
 */
export function renderPanel({ title, unit, kind, better, rows }) {
  const vs = versusParquet(rows, better);
  const arrow = better === "higher" ? "↑" : "↓";
  const bars = panelRows(rows, better, unit)
    .map((r) => {
      const fill = r.score === null ? "" : `<span class="vx-bar-fill" style="width:${Math.max(1.5, r.width)}%"></span>`;
      return `<div class="vx-bar${r.ours ? " is-ours" : ""}"><span>${esc(r.system)}</span><span class="vx-bar-track">${fill}</span><span class="vx-bar-value">${esc(r.label)}</span></div>`;
    })
    .join("");
  const head = `<div class="vx-label-sm vx-bench-title"><span class="vx-bench-metric">${esc(title)}</span><span class="vx-bench-unit"><span class="vx-keep-case">${esc(unit)}</span> ${arrow}</span></div>`;
  return `<div class="vx-bench-panel">${head}<div class="vx-stat vx-bench-big">${formatFactor(vs.factor)}<span class="vx-caption vx-bench-note">${esc(panelNote(kind, vs))}</span></div><div class="vx-bars">${bars}</div></div>`;
}
