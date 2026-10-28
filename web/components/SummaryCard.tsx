// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { displayFormat, displaySeriesLabel } from '@/lib/chart-format';
import { formatTimeNs } from '@/lib/format';
import type { SeriesRanking, Summary } from '@/lib/summary';

/**
 * Hover text for a ranked series: its full label plus, when the series was not
 * measured everywhere, how much of its score came from the missing-bucket
 * penalty. A partially measured series is ranked, not hidden, so the coverage
 * has to be legible somewhere.
 */
function seriesTitle(item: SeriesRanking, coverageUnit: string): string {
  const label = displaySeriesLabel(item.name);
  return item.measured >= item.total
    ? label
    : `${label} - measured in ${item.measured} of ${item.total} ${coverageUnit}; the rest scored by the missing-series penalty`;
}

function formatCompressionSizeRatio(value: number): string {
  return `${Number(value.toPrecision(3))}x`;
}

function formatThroughput(valueGbS: number, operation: 'encode' | 'decode'): string {
  return operation === 'encode'
    ? `${(valueGbS * 1000).toFixed(0)} MB/s`
    : `${valueGbS.toFixed(2)} GB/s`;
}

/**
 * The per-group summary card.
 *
 * Every [`Summary`] variant renders a `.benchmark-scores-summary` with an
 * explanation footer. Compression and compression-size summaries use custom
 * panels for their paired metrics. The three timing families (query, random
 * access, vector search) share one ranked-list arm because they use the same
 * [`SeriesRanking`] shape. The card stays visible when its group is collapsed,
 * so the at-a-glance rankings do not require chart expansion.
 *
 * Returns `null` when there is no summary or the variant has no content.
 */
export function SummaryCard({ summary }: { summary?: Summary }) {
  if (summary === undefined) {
    return null;
  }
  switch (summary.type) {
    case 'compression': {
      if (summary.rankings.length === 0) {
        return null;
      }
      const operationPanels = [
        { operation: 'encode' as const, title: summary.title },
        { operation: 'decode' as const, title: 'Scan Throughput' },
      ];
      return (
        <section
          className="benchmark-scores-summary benchmark-scores-summary--compression"
          aria-label={`${summary.title} and Scan Throughput`}
        >
          <div className="compression-scores">
            {operationPanels.map((panel) => {
              const rankings = summary.rankings.filter(
                (item) => item.operation === panel.operation,
              );
              if (rankings.length === 0) {
                return null;
              }
              return (
                <section className="compression-scores-panel" key={panel.operation}>
                  <h3 className="scores-title">{panel.title}</h3>
                  <div className="scores-list compression-scores-list">
                    {rankings.map((item, idx) => {
                      const label = displayFormat(item.name);
                      return (
                        <div className="score-item" key={item.name}>
                          <span className="score-rank">#{idx + 1}</span>
                          <span className="score-series" title={label}>
                            {label}
                          </span>
                          <span className="score-metrics">
                            <span className="score-value">{item.ratio.toFixed(2)}x</span>
                            {item.throughputGbS !== undefined && (
                              <span className="score-runtime">
                                {formatThroughput(item.throughputGbS, item.operation)}
                              </span>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
          <div className="scores-explanation">{summary.explanation}</div>
        </section>
      );
    }
    case 'compressionSize': {
      if (summary.rankings.length === 0) {
        return null;
      }
      return (
        <section className="benchmark-scores-summary" aria-label={summary.title}>
          <div className="compression-size-scores">
            <div className="compression-size-panel compression-size-arrow-panel">
              <div className="compression-size-arrow-header">
                <span className="compression-size-group">Vs Arrow</span>
              </div>
              <div className="compression-size-arrow-list">
                {summary.rankings.map((item, idx) => {
                  const label = displayFormat(item.name);
                  return (
                    <div className="score-item compression-size-arrow-row" key={item.name}>
                      <span className="score-rank">#{idx + 1}</span>
                      <span className="score-series" title={label}>
                        {label}
                      </span>
                      <span className="score-value compression-size-value">
                        {item.compressionRatio === null
                          ? '—'
                          : formatCompressionSizeRatio(item.compressionRatio)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="compression-size-panel compression-size-parquet-panel">
              <div className="compression-size-parquet-header">
                <span className="compression-size-group">Vs Parquet</span>
                <span className="compression-size-heading">⬇️ Min</span>
                <span className="compression-size-heading">📊 Mean</span>
                <span className="compression-size-heading">⬆️ Max</span>
              </div>
              <div className="compression-size-parquet-list">
                {summary.rankings.map((item) => {
                  const minRatio = formatCompressionSizeRatio(item.minRatio);
                  const meanRatio = formatCompressionSizeRatio(item.ratio);
                  const maxRatio = formatCompressionSizeRatio(item.maxRatio);
                  return (
                    <div className="compression-size-parquet-row" key={item.name}>
                      <span className="visually-hidden">
                        {`${displayFormat(item.name)}: minimum ${minRatio}, mean ${meanRatio}, maximum ${maxRatio}`}
                      </span>
                      <span aria-hidden="true" className="score-runtime compression-size-value">
                        {minRatio}
                      </span>
                      <span aria-hidden="true" className="score-value compression-size-value">
                        {meanRatio}
                      </span>
                      <span aria-hidden="true" className="score-runtime compression-size-value">
                        {maxRatio}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="scores-explanation">{summary.explanation}</div>
        </section>
      );
    }
    case 'randomAccess': {
      const panels = [
        {
          title: 'Hot',
          description: 'The benchmark reuses an accessor after a one-second warm-up.',
          rankings: summary.hotRankings,
        },
        {
          title: 'Cold',
          description:
            'The benchmark opens a new accessor inside each timed take. It does not clear the OS page cache.',
          rankings: summary.coldRankings,
        },
      ].filter((panel) => panel.rankings.length > 0);
      if (panels.length === 0) {
        return null;
      }
      return (
        <section
          className="benchmark-scores-summary benchmark-scores-summary--random-access"
          aria-label={`${panels.map((panel) => panel.title).join(' and ')} Random Access`}
        >
          <div
            className={
              panels.length === 1
                ? 'random-access-scores random-access-scores--single'
                : 'random-access-scores'
            }
          >
            {panels.map((panel) => (
              <section className="random-access-scores-panel" key={panel.title}>
                <h3
                  className="scores-title"
                  title={panel.description}
                  aria-label={`${panel.title}: ${panel.description}`}
                >
                  {panel.title}
                </h3>
                <div className="scores-list random-access-scores-list">
                  {panel.rankings.map((item, idx) => (
                    <div className="score-item" key={item.name}>
                      <span className="score-rank">#{idx + 1}</span>
                      <span className="score-series" title={seriesTitle(item, 'datasets')}>
                        {displaySeriesLabel(item.name)}
                      </span>
                      <span className="score-metrics">
                        <span className="score-value">{item.score.toFixed(2)}x</span>
                        <span className="score-runtime">
                          {item.measured > 0 ? formatTimeNs(item.totalRuntime) : '—'}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
          <div className="scores-explanation">{summary.explanation}</div>
        </section>
      );
    }
    case 'queryBenchmark':
    case 'vectorSearch':
      if (summary.rankings.length === 0) {
        return null;
      }
      const coverageUnit = summary.type === 'vectorSearch' ? 'thresholds' : 'queries';
      return (
        <section className="benchmark-scores-summary" aria-label={summary.title}>
          <h3 className="scores-title">{summary.title}</h3>
          <div
            className={
              summary.rankings.length >= 5 ? 'scores-list scores-list--split' : 'scores-list'
            }
          >
            {summary.rankings.map((item, idx) => (
              <div className="score-item" key={item.name}>
                <span className="score-rank">#{idx + 1}</span>
                <span className="score-series" title={seriesTitle(item, coverageUnit)}>
                  {displaySeriesLabel(item.name)}
                </span>
                <span className="score-metrics">
                  <span className="score-value">{item.score.toFixed(2)}x</span>
                  <span className="score-runtime">
                    {item.measured > 0 ? formatTimeNs(item.totalRuntime) : '—'}
                  </span>
                </span>
              </div>
            ))}
          </div>
          <div className="scores-explanation">{summary.explanation}</div>
        </section>
      );
    default: {
      // Exhaustiveness guard: adding a new `Summary` variant without a render
      // arm above becomes a compile error here instead of a silently blank card.
      const exhaustive: never = summary;
      return exhaustive;
    }
  }
}
