import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BenchmarkCard, BenchPanel } from "@/components/benchmark-card";
import { type Panel, panelsFrom } from "@/lib/bench-summary";
import { renderPanel } from "@/vendor/vortex-design/benchmark-card.js";

const PAYLOAD = JSON.parse(
  readFileSync(new URL("./fixtures/bench-groups.json", import.meta.url), "utf8")
) as { groups: unknown };
const PANELS = panelsFrom(PAYLOAD.groups);

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
      title: "Random access, NVMe, cold",
      unit: "× fastest",
      kind: "speed",
      better: "lower",
      rows: [
        { system: "Vortex", score: 1.18, measured: 4, total: 4 },
        { system: "Parquet", score: 38.2, measured: 3, total: 4 },
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
        '<h2 class="vx-bench-headline">Vortex against Parquet, Lance and Arrow <span class="vx-bench-sub">· times against the fastest run, the rest against Parquet, best first</span></h2>'
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

  // Note 34: the bars and the big figure read the same scores, so NVMe's bars
  // give the 32× above them, not the 29× that bench's totals gave. Note 62:
  // each bar ends in its score, and its score with the unit, which the panel
  // no longer prints, is its screen-reader text and title.
  it("ends each bar in bench's score, keeps the unit for screen readers and hover, and the bars agree with the factor", () => {
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
        ["5.12", "1.00", "0.90"],
        ["1.57", "1.00", "0.54"],
        ["1.26", "2.01", "17.50"],
        ["3.90", "1.00", "N/A"],
        ["1.18", "1.90", "2.10", "38.20"],
        ["1", "1.07", "1.99", "5.59"]
      ].flat()
    );
    const exact = [...html.matchAll(/class="vx-sr-only">([^<]*)</g)].map(
      (m) => m[1]
    );
    assert.deepEqual(
      exact,
      [
        ["5.12× Parquet", "1.00× Parquet", "0.90× Parquet"],
        ["1.57× Parquet", "1.00× Parquet", "0.54× Parquet"],
        ["1.26× fastest", "2.01× fastest", "17.50× fastest"],
        [
          "3.90× Parquet",
          "1.00× Parquet",
          "not available, no cuDF integration"
        ],
        ["1.18× fastest", "1.90× fastest", "2.10× fastest", "38.20× fastest"],
        ["1×", "1.07×", "1.99×", "5.59×"]
      ].flat()
    );
    assert.match(html, /<div class="vx-bar" title="Arrow: 2\.10× fastest">/);
    const factors = [
      ...html.matchAll(/class="vx-bench-big"><span class="vx-stat">([^<]*)</g)
    ].map((m) => m[1]);
    assert.deepEqual(factors, ["5.1×", "1.6×", "1.6×", "3.9×", "32×", "1.07×"]);
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

  // The GPU panel is not bench's, so the card names it and its source in a
  // line under the panels, without a link. Lance cannot run in cuDF, so its
  // row is N/A, not Not measured.
  it("names the hand-kept GPU panel's source under the panels, and shows Lance as N/A", () => {
    assert.ok(PANELS);
    const html = renderToStaticMarkup(
      <BenchmarkCard panels={PANELS} readAt={new Date("2026-10-29")} />
    );
    assert.ok(
      html.includes(
        '<span class="vx-bench-metric">GPU analytics with cuDF</span>'
      )
    );
    assert.doesNotMatch(html, /vx-bench-mark|<sup/);
    assert.match(
      html,
      /<p class="vx-caption vx-bench-foot">GPU analytics with cuDF: end to end, hot, on GH200, NDS-H SF10, from the Vortex UW–Madison talk<\/p><\/section>$/
    );
    assert.equal(html.match(/<a /g)?.length, 1, "one link, to bench");
    assert.ok(
      html.includes(
        '<div class="vx-bar is-na" title="Lance: not available, no cuDF integration"><span>Lance</span><span class="vx-bar-track"></span><span class="vx-bar-value" aria-hidden="true">N/A</span>'
      )
    );
  });

  it("prints no source line when every panel is bench's", () => {
    assert.ok(PANELS);
    const html = renderToStaticMarkup(
      <BenchmarkCard
        panels={PANELS.filter((p) => !p.source)}
        readAt={new Date("2026-10-29")}
      />
    );
    assert.doesNotMatch(html, /vx-bench-foot/);
  });
});
