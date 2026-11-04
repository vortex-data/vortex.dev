import { OpenInNewIcon } from "@/components/icons";
import { formatReadDate, type Panel } from "@/lib/bench-summary";
import {
  resultsNotes,
  resultsRow,
  resultsSystems
} from "@/vendor/vortex-design/results.js";

const SOURCE_URL = "https://bench.vortex.dev";

const classes = (...names: (string | false)[]) =>
  names.filter(Boolean).join(" ") || undefined;

/**
 * The design system's results table, drawn in JSX from the system's own
 * rules (results.js): a row per panel and a column per system, Vortex
 * first in Blue, the best figure in each row underlined, and how Vortex does
 * against Parquet last. Its markup is the same as the system's
 * `renderResults`, and tests/unit/results-table.test.tsx holds it there. A
 * row whose figures are not bench's names their source in its head's hover
 * title and screen-reader text. The page leaves the table out when the
 * figures cannot be read. The head names bench and the read date on one line,
 * and the foot keys the underline and gives each panel's range
 * (`resultsNotes`).
 */
export function ResultsTable({
  panels,
  readAt
}: {
  panels: readonly Panel[];
  readAt: Date;
}) {
  const systems = resultsSystems(panels);
  return (
    <section className="vx-frame vx-results" aria-label="Benchmark results">
      <p className="vx-results-head">
        <span>File format benchmarks</span>
        <span className="vx-results-src">
          <a className="vx-source vx-nav-link" href={SOURCE_URL}>
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
                vs Parquet
              </th>
            </tr>
          </thead>
          <tbody>
            {panels.map((panel) => {
              const row = resultsRow(panel, systems);
              return (
                <tr key={panel.title}>
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
                        c.state !== "measured" && "is-missing"
                      )}
                      title={`${c.system}: ${c.exact}`}
                    >
                      {c.label}
                    </td>
                  ))}
                  <td className="is-verdict">{row.verdict}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="vx-results-foot">
        <span>Underlined: the best in each row</span>
        {resultsNotes(panels).map((note) => (
          <span key={note}>{note}</span>
        ))}
      </p>
    </section>
  );
}
