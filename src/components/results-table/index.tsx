import { OpenInNewIcon } from "@/components/icons";
import { benchHref } from "@/lib/bench-link";
import { formatReadDate, type Panel } from "@/lib/bench-summary";
import {
  FAR_KEY,
  resultsRow,
  resultsSystems
} from "@/vendor/vortex-design/results.js";

/** The system a phone compares Vortex with, after Parquet, in place of the figures. */
const RIVAL = "Lance";

const classes = (...names: (string | false)[]) =>
  names.filter(Boolean).join(" ") || undefined;

/**
 * The design system's results table, drawn in JSX from the system's own
 * rules (results.js): a row per panel and a column per system, Vortex
 * first in Blue, the best figure in each row underlined, a figure 10× or more
 * behind it dotted, and how Vortex does against Parquet last. A phone shows
 * only the verdicts: against Parquet, and against Lance. Its markup is
 * the same as the system's `renderResults`, and
 * tests/unit/results-table.test.tsx holds it there. A
 * row whose figures are not bench's names their source in its head's hover
 * title and screen-reader text. The page leaves the table out when the
 * figures cannot be read. The head names bench and the read date on one line,
 * and the foot keys the underline, and the dots when a cell has them.
 */
export function ResultsTable({
  panels,
  readAt
}: {
  panels: readonly Panel[];
  readAt: Date;
}) {
  const systems = resultsSystems(panels);
  const rows = panels.map((panel) =>
    resultsRow(panel, systems, { rival: RIVAL })
  );
  return (
    <section className="vx-frame vx-results" aria-label="Benchmark results">
      <p className="vx-results-head">
        <span>File format benchmarks</span>
        <span className="vx-label-sm vx-results-src">
          <a className="vx-source vx-nav-link" href={benchHref()}>
            bench.vortex.dev
            <OpenInNewIcon />
          </a>
          <span aria-hidden="true">·</span>
          <span>read {formatReadDate(readAt)}</span>
        </span>
      </p>
      <div className="vx-results-wrap">
        <table className="vx-results-table">
          <thead>
            <tr>
              <th scope="col">Benchmark</th>
              {systems.map((s) => (
                <th
                  key={s}
                  scope="col"
                  className={classes(s.toLowerCase() === "vortex" && "is-ours")}
                >
                  {s}
                </th>
              ))}
              <th scope="col" className="is-verdict">
                <span className="vx-results-subject">Vortex </span>vs Parquet
              </th>
              <th scope="col" className="is-verdict is-rival">
                <span className="vx-results-subject">Vortex </span>vs {RIVAL}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              return (
                <tr key={row.name}>
                  <th scope="row" title={row.source?.note}>
                    {row.name}
                    {row.source && (
                      <span className="vx-sr-only">, {row.source.note}</span>
                    )}
                  </th>
                  {row.cells.map((c) => (
                    <td
                      key={c.system}
                      className={classes(
                        c.ours && "is-ours",
                        c.best && "is-best",
                        c.far && "is-far",
                        c.state !== "measured" && "is-missing"
                      )}
                      title={`${c.system}: ${c.exact}`}
                    >
                      {c.label}
                    </td>
                  ))}
                  <td className="is-verdict">{row.verdict}</td>
                  <td className="is-verdict is-rival">{row.rivalVerdict}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="vx-results-foot">
        <span>Underlined: the best in each row</span>
        {rows.some((row) => row.cells.some((c) => c.far)) && (
          <span>{FAR_KEY}</span>
        )}
      </p>
    </section>
  );
}
