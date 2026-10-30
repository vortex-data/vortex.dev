import type { CSSProperties } from "react";
import { OpenInNewIcon } from "@/components/icons";
import { formatReadDate, type Panel } from "@/lib/bench-summary";
import {
  barClass,
  benchCaption,
  benchMethod,
  panelFactor,
  panelNote,
  panelRows,
  pickSystems,
  valueWidth,
  versusParquet
} from "@/vendor/vortex-design/benchmark-card.js";

const SOURCE_URL = "https://bench.vortex.dev";

/**
 * One panel of the design system's BenchmarkCard, drawn in JSX from the
 * system's own rules (benchmark-card.js). Its markup is the same as the
 * system's `renderPanel`, and tests/unit/benchmark-card.test.tsx holds it
 * there: the metric, the figure against Parquet with the words that say who
 * won, and the bars best first, each ending in its value with a short unit
 * ("42.25 ms", "5.12×") in a column as wide as the panel's longest value.
 * The value with its full unit is each bar's title and screen-reader text. A
 * system that cannot run the benchmark is N/A, with its reason.
 */
export function BenchPanel({ panel }: { panel: Panel }) {
  const { title, unit, kind, better, rows, systems, source } = panel;
  const vs = versusParquet(rows, better);
  const shown = panelRows(pickSystems(rows, systems), better, unit);
  const column = { "--bar-value": valueWidth(shown) } as CSSProperties;
  return (
    <div className="vx-bench-panel">
      <div className="vx-label-sm vx-bench-title" title={source?.note}>
        <span className="vx-bench-metric">{title}</span>
        {source && <span className="vx-sr-only">, {source.note}</span>}
      </div>
      <div className="vx-bench-big">
        <span className="vx-stat">{panelFactor(kind, vs)}</span>{" "}
        <span className="vx-caption vx-bench-note">{panelNote(kind, vs)}</span>
      </div>
      <div className="vx-bars" style={column}>
        {shown.map((r) => {
          const className = barClass(r);
          const tip = `${r.system}: ${r.exact}`;
          if (r.state === "not-measured")
            return (
              <div key={r.system} className={className} title={tip}>
                <span>{r.system}</span>
                <span className="vx-bar-missing">Not measured</span>
              </div>
            );
          return (
            <div key={r.system} className={className} title={tip}>
              <span>{r.system}</span>
              <span className="vx-bar-track">
                {r.state === "measured" && (
                  <span
                    className="vx-bar-fill"
                    style={{ width: `${Math.max(1.5, r.width)}%` }}
                  />
                )}
              </span>
              <span className="vx-bar-value" aria-hidden="true">
                {r.label}
              </span>
              <span className="vx-sr-only">{r.exact}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The design system's BenchmarkCard: Vortex against Parquet, Lance, and Arrow
 * in six panels, with a short caption that names the panels' units (and the
 * method behind them as its title and screen-reader text), a source line
 * that names bench.vortex.dev and the read date, and a line for each panel
 * whose figures are not bench's. The panels come from `getBenchSummary`; the
 * page leaves the card out when that read fails.
 */
export function BenchmarkCard({
  panels,
  readAt
}: {
  panels: readonly Panel[];
  readAt: Date;
}) {
  const method = benchMethod(panels);
  return (
    <section className="vx-card vx-bench" aria-label="Benchmark summary">
      <div className="vx-bench-head">
        <h2 className="vx-bench-headline">
          Vortex against Parquet, Lance, and Arrow{" "}
          <span className="vx-bench-sub" title={method}>
            · {benchCaption(panels)}
            <span className="vx-sr-only">. {method}</span>
          </span>
        </h2>
        <a className="vx-label-sm vx-source vx-nav-link" href={SOURCE_URL}>
          <span className="vx-keep-case">bench.vortex.dev</span>
          {" · read "}
          <time dateTime={readAt.toISOString().slice(0, 10)}>
            {formatReadDate(readAt)}
          </time>
          <OpenInNewIcon />
        </a>
      </div>
      <div className="vx-bench-panels">
        {panels.map((panel) => (
          <BenchPanel key={panel.title} panel={panel} />
        ))}
      </div>
    </section>
  );
}
