import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BenchmarkCard, BenchPanel } from "@/components/benchmark-card";
import { type Panel, panelsFrom } from "@/lib/bench-summary";
import { renderPanel } from "@/vendor/vortex-design/benchmark-card.js";

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")
  ) as Record<string, unknown>;
const PANELS = panelsFrom(fixture("bench-groups.json").groups, {
  Clickbench: fixture("bench-group-clickbench.json"),
  "Random Access (NVMe)": fixture("bench-group-random-access-nvme.json")
});

// A panel as the system draws it and as the site draws it must be the same
// markup, so the site cannot drift from the system's BenchmarkCard.
describe("BenchPanel", () => {
  it("draws each panel exactly as the system's renderPanel does", () => {
    assert.ok(PANELS);
    assert.equal(PANELS.length, 6);
    for (const panel of PANELS)
      assert.equal(
        renderToStaticMarkup(<BenchPanel panel={panel} />),
        renderPanel(panel),
        panel.title
      );
  });

  it("matches renderPanel for a missing and a partial system", () => {
    const panel: Panel = {
      title: "Random access, NVMe, hot",
      unit: "ms",
      kind: "speed",
      better: "lower",
      rows: [
        { system: "Vortex", score: 2.22, measured: 4, total: 4 },
        { system: "Parquet", score: 70.36, measured: 3, total: 4 },
        { system: "Lance", score: null }
      ]
    };
    const html = renderToStaticMarkup(<BenchPanel panel={panel} />);
    assert.equal(html, renderPanel(panel));
    assert.match(html, /Parquet not measured/);
    // Each says so where its bar would be, and in its hover title.
    assert.equal(html.match(/>Not measured</g)?.length, 2);
    assert.equal(html.match(/: Not measured"/g)?.length, 2);
    const noVortex = {
      ...panel,
      rows: panel.rows.map((r) =>
        r.system === "Vortex" ? { ...r, score: null } : r
      )
    };
    assert.equal(
      renderToStaticMarkup(<BenchPanel panel={noVortex} />),
      renderPanel(noVortex)
    );
  });
});

describe("BenchmarkCard", () => {
  it("heads the panels with the headline and a dated source link", () => {
    assert.ok(PANELS);
    const html = renderToStaticMarkup(
      <BenchmarkCard
        panels={PANELS}
        readAt={new Date("2026-10-28T22:55:18Z")}
      />
    );
    assert.match(
      html,
      /^<section class="vx-card vx-bench" aria-label="Benchmark summary">/
    );
    assert.ok(
      html.includes(
        '<h2 class="vx-bench-headline">Vortex against Parquet, Lance, and Arrow <span class="vx-bench-sub" title="A time is the geomean over the queries or datasets that bench&#x27;s score covers. A ratio is against Parquet = 1.">· times in ms, ratios to Parquet, best first<span class="vx-sr-only">. A time is the geomean over the queries or datasets that bench&#x27;s score covers. A ratio is against Parquet = 1.</span></span></h2>'
      )
    );
    assert.ok(
      html.includes(
        '<a class="vx-label-sm vx-source vx-nav-link" href="https://bench.vortex.dev"><span class="vx-keep-case">bench.vortex.dev</span> · read <time dateTime="2026-10-28">28 Oct 2026</time><svg'
      ),
      html
    );
    assert.equal(html.match(/class="vx-bench-panel"/g)?.length, 6);
  });

  // When a time panel falls back to bench's scores, the caption says so,
  // because those values are against the fastest, not against Parquet.
  it("describes a score fallback in the caption", () => {
    const fallback = panelsFrom(fixture("bench-groups.json").groups, {
      "Random Access (NVMe)": fixture("bench-group-random-access-nvme.json")
    });
    assert.ok(fallback);
    const html = renderToStaticMarkup(
      <BenchmarkCard
        panels={fallback}
        readAt={new Date("2026-10-28T22:55:18Z")}
      />
    );
    assert.ok(
      html.includes(
        "· times in ms, scores against the fastest, ratios to Parquet, best first<"
      ),
      html
    );
    assert.ok(
      html.includes(
        "A score is bench&#x27;s score against the fastest run = 1. It stands in for times that do not cover every query."
      ),
      html
    );
  });

  // Note 34: the bars and the big figure read the same numbers, so NVMe's
  // bars give the 97× above them. Note 63: time panels show geomean ms, each
  // value carries a short unit, and below 2× the figure is a percentage.
  it("ends each bar in its value and unit, keeps the full unit for screen readers and hover, and the bars agree with the figure", () => {
    assert.ok(PANELS);
    const html = renderToStaticMarkup(
      <BenchmarkCard panels={PANELS} readAt={new Date("2026-10-29")} />
    );
    assert.doesNotMatch(html, /vx-bench-unit/);
    const values = [
      ...html.matchAll(/class="vx-bar-value" aria-hidden="true">([^<]*)</g)
    ].map((m) => m[1]);
    assert.deepEqual(
      values,
      [
        ["4.93×", "1.00×", "0.90×"],
        ["1.58×", "1.00×", "0.53×"],
        ["42.25 ms", "65.62 ms", "578.63 ms"],
        ["17.00 ms", "65.88 ms", "N/A"],
        ["0.73 ms", "2.15 ms", "3.78 ms", "70.61 ms"],
        ["1×", "1.07×", "1.99×", "5.59×"]
      ].flat()
    );
    // The bars' screen-reader text, which follows each bar's visible value.
    const exact = [
      ...html.matchAll(
        /aria-hidden="true">[^<]*<\/span><span class="vx-sr-only">([^<]*)</g
      )
    ].map((m) => m[1]);
    assert.deepEqual(
      exact,
      [
        ["4.93× Parquet", "1.00× Parquet", "0.90× Parquet"],
        ["1.58× Parquet", "1.00× Parquet", "0.53× Parquet"],
        ["42.25 ms", "65.62 ms", "578.63 ms"],
        ["17.00 ms", "65.88 ms", "not available, no cuDF integration"],
        ["0.73 ms", "2.15 ms", "3.78 ms", "70.61 ms"],
        ["1×", "1.07×", "1.99×", "5.59×"]
      ].flat()
    );
    assert.match(html, /<div class="vx-bar is-arrow" title="Arrow: 3\.78 ms">/);
    const big = [
      ...html.matchAll(
        /class="vx-bench-big"><span class="vx-stat">([^<]*)<\/span> <span class="vx-caption vx-bench-note">([^<]*)</g
      )
    ].map((m) => `${m[1]} ${m[2]}`);
    assert.deepEqual(big, [
      "4.9× faster than Parquet",
      "58% faster than Parquet",
      "55% faster than Parquet",
      "3.9× faster than Parquet",
      "97× faster than Parquet",
      "7% larger than Parquet"
    ]);
    // Each panel's value column fits its longest value, so its bars share a scale.
    const columns = [
      ...html.matchAll(/<div class="vx-bars" style="--bar-value:(\d+)ch">/g)
    ].map((m) => Number(m[1]));
    assert.deepEqual(columns, [5, 5, 9, 8, 8, 5]);
  });

  it("shows Arrow only where bench runs it, and Lance in every bench panel", () => {
    assert.ok(PANELS);
    const shown = PANELS.map((p) =>
      [
        ...renderToStaticMarkup(<BenchPanel panel={p} />).matchAll(
          /class="vx-bar[^"]*" title="([^:]+):/g
        )
      ].map((m) => m[1])
    );
    assert.deepEqual(shown, [
      ["Vortex", "Parquet", "Lance"],
      ["Vortex", "Parquet", "Lance"],
      ["Vortex", "Parquet", "Lance"],
      ["Vortex", "Parquet", "Lance"],
      ["Vortex", "Lance", "Arrow", "Parquet"],
      ["Parquet", "Vortex", "Lance", "Arrow"]
    ]);
  });

  // The GPU panel is not bench's, so its title names its source, as the hover
  // title and screen-reader text, without a link or a line under the panels.
  // Lance cannot run in cuDF, so its row is N/A, not Not measured.
  it("names the hand-kept GPU panel's source on its title, and shows Lance as N/A", () => {
    assert.ok(PANELS);
    const html = renderToStaticMarkup(
      <BenchmarkCard panels={PANELS} readAt={new Date("2026-10-29")} />
    );
    const note =
      "end to end, hot, on GH200, NDS-H SF10, Parquet the fastest of four configurations per query, from the Vortex UW–Madison talk";
    assert.ok(
      html.includes(
        `<div class="vx-label-sm vx-bench-title" title="${note}"><span class="vx-bench-metric">GPU analytics with cuDF</span><span class="vx-sr-only">, ${note}</span></div>`
      )
    );
    assert.doesNotMatch(html, /vx-bench-mark|<sup|vx-bench-foot/);
    assert.equal(html.match(/<a /g)?.length, 1, "one link, to bench");
    assert.ok(
      html.includes(
        '<div class="vx-bar is-lance is-na" title="Lance: not available, no cuDF integration"><span>Lance</span><span class="vx-bar-track"></span><span class="vx-bar-value" aria-hidden="true">N/A</span>'
      )
    );
  });

  it("gives a bench panel's title no source", () => {
    assert.ok(PANELS);
    const html = renderToStaticMarkup(
      <BenchmarkCard
        panels={PANELS.filter((p) => !p.source)}
        readAt={new Date("2026-10-29")}
      />
    );
    assert.doesNotMatch(html, /vx-bench-title" title=|vx-bench-foot/);
  });
});
