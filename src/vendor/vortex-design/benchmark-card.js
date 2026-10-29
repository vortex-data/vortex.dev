// The rules of the benchmark card, kept free of the DOM so they can be tested.
// A row is {system, score, measured?, total?, unavailable?}: `score` is bench's own published geomean for that
// system (a time ratio to the fastest series, or a throughput or size ratio to Parquet), and
// `measured` and `total` are bench's coverage: the datasets or queries the system ran, of all of
// them. `unavailable` is the reason a system cannot run the benchmark at all ("no cuDF integration"):
// that row is "N/A", where "Not measured" means it could run but has no result. The bars and the
// big figure both read the scores, so they always agree, and the card never
// claims a ratio bench does not publish. A panel whose figures come from elsewhere names its source
// (`source`), and the card lists it (`sourceNotes`).
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
 * A score with its unit, for screen readers and the bar's hover title, now that the bars print no
 * numbers and the panels no unit: "38.20× fastest", "5.12× Parquet", "1.07×", or "Not measured".
 */
export function exactValue(score, unit) {
  if (!Number.isFinite(score)) return "Not measured";
  // Every unit starts with "×", which joins the number as bench prints it ("38.20x").
  return `${formatScore(score, unit)}${String(unit).startsWith("×") ? "" : " "}${unit}`;
}

/**
 * The rows a panel shows: one per name in `systems`, in that order, matched whatever the case. A
 * named system with no row gets one with no score, so the panel says "Not measured". With no
 * `systems`, every row shows. The factor compares Vortex with Parquet, so `systems` must name both.
 */
export function pickSystems(rows, systems) {
  if (!systems) return rows;
  for (const need of ["Vortex", "Parquet"]) {
    if (!systems.some((s) => String(s).toLowerCase() === need.toLowerCase())) throw new Error(`systems must name ${need}: the factor compares Vortex with Parquet`);
  }
  return systems.map((name) => find(rows, String(name).toLowerCase()) ?? { system: name, score: null });
}

/**
 * One panel's rows, best first. Each row is {system, score, width, label, exact, state, ours}:
 * `width` is the score as a percentage of the panel's largest (0 when missing), so in a
 * lower-is-better panel the best system has the shortest bar. `state` is "measured",
 * "not-measured" or "n/a". `label` is the score as bench prints it, "Not measured" or "N/A", and
 * `exact` is what screen readers and the hover title get: the score with its unit
 * (`exactValue`), "Not measured", or "not available, " and the reason. A row with no score, or
 * measured on only part of the workload, keeps its place after the measured ones with score null,
 * so its absence never reads as zero. N/A rows come last.
 */
export function panelRows(rows, better, unit) {
  const na = rows.filter((r) => r?.unavailable);
  const measured = rows.filter((r) => !r?.unavailable && isMeasured(r));
  const missing = rows.filter((r) => !r?.unavailable && !isMeasured(r));
  measured.sort((a, b) => (better === "higher" ? b.score - a.score : a.score - b.score));
  const max = Math.max(...measured.map((r) => r.score), 0);
  return [
    ...measured.map((r) => ({ system: r.system, score: r.score, width: max ? (r.score / max) * 100 : 0, label: formatScore(r.score, unit), exact: exactValue(r.score, unit), state: "measured", ours: isOurs(r.system) })),
    ...missing.map((r) => ({ system: r.system, score: null, width: 0, label: "Not measured", exact: "Not measured", state: "not-measured", ours: isOurs(r.system) })),
    ...na.map((r) => ({ system: r.system, score: null, width: 0, label: "N/A", exact: `not available, ${r.unavailable}`, state: "n/a", ours: isOurs(r.system) })),
  ];
}

/**
 * Vortex against Parquet: {factor, vortexWins, tie, missing}. `factor` is the ratio of their
 * scores, at least 1, and says how far apart they are; `vortexWins` says which way. Equal scores
 * are a tie: `factor` is 1, `tie` is true and `vortexWins` is false. When Vortex or Parquet is not
 * measured (see `panelRows`), `factor`, `vortexWins` and `tie` are null and `missing` names the one
 * that is, Vortex first. Otherwise `missing` is null.
 */
export function versusParquet(rows, better) {
  const v = find(rows, "vortex");
  const p = find(rows, "parquet");
  if (!isMeasured(v) || !isMeasured(p)) return { factor: null, vortexWins: null, tie: null, missing: isMeasured(v) ? "Parquet" : "Vortex" };
  const vortexWins = better === "higher" ? v.score > p.score : v.score < p.score;
  return { factor: Math.max(v.score / p.score, p.score / v.score), vortexWins, tie: v.score === p.score, missing: null };
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
export function panelNote(kind, { vortexWins, tie, missing }) {
  if (vortexWins === null || vortexWins === undefined) return `${missing ?? "Vortex"} not measured`;
  if (tie) return kind === "size" ? "the same size as Parquet" : "as fast as Parquet";
  const words = kind === "size" ? (vortexWins ? "smaller" : "larger") : vortexWins ? "faster" : "slower";
  return `${words} than Parquet`;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/**
 * The card's lines for panels whose figures do not come from bench, in panel order, each naming
 * its panel: "GPU analytics with cuDF: end to end, hot, on GH200, NDS-H SF10". The card prints
 * them under the panels.
 */
export function sourceNotes(panels) {
  return panels.filter((p) => p.source).map((p) => `${p.title}: ${p.source.note}`);
}

/**
 * One panel's markup. A panel is {title, unit, kind, better, rows, systems?, source?}: the metric's
 * name, what its scores are measured against ("× fastest", "× Parquet", or "×" for the file-size
 * ratio), "speed" or "size", "higher" or "lower", the rows, the systems to show (`pickSystems`) and,
 * for figures that are not bench's, {note}, which `sourceNotes` prints under the panels. The panel
 * prints no unit and no direction: the card's caption says what the scores are measured against,
 * and the bars run best first. Each bar ends in its score as bench prints it, so the reader sees
 * how far apart the systems are. The score with its unit is the bar's hover title and its
 * screen-reader text.
 */
export function renderPanel({ title, unit, kind, better, rows, systems }) {
  const vs = versusParquet(rows, better);
  const bars = panelRows(pickSystems(rows, systems), better, unit)
    .map((r) => {
      const cls = `vx-bar${r.ours ? " is-ours" : ""}${{ "not-measured": " is-missing", "n/a": " is-na" }[r.state] ?? ""}`;
      const tip = `title="${esc(r.system)}: ${esc(r.exact)}"`;
      if (r.state === "not-measured") return `<div class="${cls}" ${tip}><span>${esc(r.system)}</span><span class="vx-bar-missing">Not measured</span></div>`;
      const fill = r.state === "n/a" ? "" : `<span class="vx-bar-fill" style="width:${Math.max(1.5, r.width)}%"></span>`;
      return `<div class="${cls}" ${tip}><span>${esc(r.system)}</span><span class="vx-bar-track">${fill}</span><span class="vx-bar-value" aria-hidden="true">${esc(r.label)}</span><span class="vx-sr-only">${esc(r.exact)}</span></div>`;
    })
    .join("");
  const head = `<div class="vx-label-sm vx-bench-title"><span class="vx-bench-metric">${esc(title)}</span></div>`;
  return `<div class="vx-bench-panel">${head}<div class="vx-bench-big"><span class="vx-stat">${formatFactor(vs.factor)}</span> <span class="vx-caption vx-bench-note">${esc(panelNote(kind, vs))}</span></div><div class="vx-bars">${bars}</div></div>`;
}
