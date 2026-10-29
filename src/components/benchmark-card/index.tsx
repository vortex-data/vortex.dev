import { OpenInNewIcon } from "@/components/icons";
import { formatReadDate, type Panel } from "@/lib/bench-summary";
import {
  formatFactor,
  panelNote,
  panelRows,
  versusParquet
} from "@/vendor/vortex-design/benchmark-card.js";

const SOURCE_URL = "https://bench.vortex.dev";

/**
 * One panel of the design system's BenchmarkCard, drawn in JSX from the
 * system's own rules (benchmark-card.js). Its markup is the same as the
 * system's `renderPanel`, and tests/unit/benchmark-card.test.tsx holds it
 * there: the metric with its unit and direction, the factor against Parquet
 * with the words that say who won, and the bars best first.
 */
export function BenchPanel({ panel }: { panel: Panel }) {
  const { title, unit, kind, better, rows } = panel;
  const vs = versusParquet(rows, better);
  return (
    <div className="vx-bench-panel">
      <div className="vx-label-sm vx-bench-title">
        <span className="vx-bench-metric">{title}</span>
        <span className="vx-bench-unit">
          <span className="vx-keep-case">{unit}</span>
          {` ${better === "higher" ? "↑" : "↓"}`}
        </span>
      </div>
      <div className="vx-stat vx-bench-big">
        {formatFactor(vs.factor)}
        <span className="vx-caption vx-bench-note">{panelNote(kind, vs)}</span>
      </div>
      <div className="vx-bars">
        {panelRows(rows, better, unit).map((r) => (
          <div key={r.system} className={r.ours ? "vx-bar is-ours" : "vx-bar"}>
            <span>{r.system}</span>
            <span className="vx-bar-track">
              {r.value !== null && (
                <span
                  className="vx-bar-fill"
                  style={{ width: `${Math.max(1.5, r.width)}%` }}
                />
              )}
            </span>
            <span className="vx-bar-value">{r.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The design system's BenchmarkCard: Vortex against Parquet and Lance in six
 * panels, with a source line that names bench.vortex.dev and the read date.
 * The panels come from `getBenchSummary`; the page leaves the card out when
 * that read fails.
 */
export function BenchmarkCard({
  panels,
  readAt
}: {
  panels: readonly Panel[];
  readAt: Date;
}) {
  return (
    <section className="vx-card vx-bench" aria-label="Benchmark summary">
      <div className="vx-bench-head">
        <h2 className="vx-bench-headline">
          Vortex against Parquet and Lance{" "}
          <span className="vx-bench-sub">
            · six benchmarks, best first in each
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
