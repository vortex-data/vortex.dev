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

  it("matches renderPanel for a missing system and for estimated factors", () => {
    const panel: Panel = {
      title: "Scan throughput",
      unit: "GB/s",
      kind: "speed",
      better: "higher",
      rows: [
        { system: "Vortex", value: 52.8, score: null },
        { system: "Parquet", value: 10.35, score: null },
        { system: "Lance", value: null, score: null }
      ]
    };
    const html = renderToStaticMarkup(<BenchPanel panel={panel} />);
    assert.equal(html, renderPanel(panel));
    assert.match(html, /faster than Parquet \(estimated\)/);
    assert.match(html, /Not measured/);
    const noVortex = {
      ...panel,
      rows: panel.rows.map((r) =>
        r.system === "Vortex" ? { ...r, value: null } : r
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
        '<h2 class="vx-bench-headline">Vortex against Parquet and Lance <span class="vx-bench-sub">· six CPU benchmarks, best first in each</span></h2>'
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
});
