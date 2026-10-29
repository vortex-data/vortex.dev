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
    assert.equal(html.match(/Not measured/g)?.length, 2);
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
        '<h2 class="vx-bench-headline">Vortex against Parquet and Lance <span class="vx-bench-sub">· six benchmarks, best first in each</span></h2>'
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
  // give the 32× above them, not the 29× that bench's totals gave.
  it("prints bench's scores as bench does, and the bars agree with the factor", () => {
    assert.ok(PANELS);
    const html = renderToStaticMarkup(
      <BenchmarkCard panels={PANELS} readAt={new Date("2026-10-29")} />
    );
    const values = [...html.matchAll(/class="vx-bar-value">([^<]*)</g)].map(
      (m) => m[1]
    );
    assert.deepEqual(
      values,
      [
        ["5.12", "1.00", "0.90"],
        ["1.18", "1.90", "38.20"],
        ["1.00", "2.18", "2.55"],
        ["1.57", "1.00", "0.54"],
        ["1.26", "2.01", "17.50"],
        ["1", "1.07", "1.99"]
      ].flat()
    );
    const factors = [
      ...html.matchAll(/class="vx-stat vx-bench-big">([^<]*)</g)
    ].map((m) => m[1]);
    assert.deepEqual(factors, ["5.1×", "32×", "2.5×", "1.6×", "1.6×", "1.07×"]);
  });
});
