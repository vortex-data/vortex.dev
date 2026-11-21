import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { OpenInNewIcon } from "@/components/icons";
import { ResultsTable } from "@/components/results-table";
import { benchHref } from "@/lib/bench-link";
import { formatReadDate, panelsFrom } from "@/lib/bench-summary";
import { renderResults } from "@/vendor/vortex-design/results.js";

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")
  ) as Record<string, unknown>;
const PANELS = panelsFrom(fixture("bench-groups.json").groups, {
  Clickbench: fixture("bench-group-clickbench.json"),
  "TPC-H (NVMe) (SF=10)": fixture("bench-group-tpch-sf10-nvme.json"),
  "Random Access (NVMe)": fixture("bench-group-random-access-nvme.json")
});
const READ = new Date("2026-11-02T12:00:00Z");

// The table as the system draws it and as the site draws it must be the same
// markup, so the homepage cannot drift from the system's results table.
describe("ResultsTable", () => {
  it("draws the panels exactly as the system's renderResults does", () => {
    assert.ok(PANELS);
    const html = renderToStaticMarkup(
      <ResultsTable panels={PANELS} readAt={READ} />
    );
    // The system names bench.vortex.dev; the site names it on production
    // and its own /bench elsewhere (bench-link.ts), the one difference.
    const system = renderResults(PANELS, {
      read: formatReadDate(READ),
      icon: renderToStaticMarkup(<OpenInNewIcon />),
      rival: "Lance"
    }).replace('href="https://bench.vortex.dev"', `href="${benchHref()}"`);
    assert.equal(html, system);
  });

  it("names each row by its short name and marks one best figure or more in each", () => {
    assert.ok(PANELS);
    const html = renderToStaticMarkup(
      <ResultsTable panels={PANELS} readAt={READ} />
    );
    for (const name of [
      "Scan",
      "Write",
      "ClickBench",
      "TPC-H",
      "GPU analytics",
      "Random access",
      "File size"
    ])
      assert.ok(
        html.includes(`<th scope="row"`) && html.includes(`>${name}`),
        name
      );
    assert.equal(html.match(/<tr><th scope="row"/g)?.length, 7);
    for (const row of html.split('<tr><th scope="row"').slice(1))
      assert.match(row, /is-best/);
  });

  it("dots the figures 10× or more behind their row's best, and keys the dots", () => {
    assert.ok(PANELS);
    const html = renderToStaticMarkup(
      <ResultsTable panels={PANELS} readAt={READ} />
    );
    const far = [...html.matchAll(/<td class="is-far" title="([^"]+)">/g)].map(
      (m) => m[1]
    );
    assert.deepEqual(far, [
      "Lance: 578.63 ms, 14× behind the best",
      "Lance: 846.80 ms, 14× behind the best",
      "Parquet: 70.61 ms, 97× behind the best"
    ]);
    assert.match(
      html,
      /<span>Underlined: the best in each row<\/span><span>Dotted: 10× or more behind the best<\/span><\/p>/
    );
  });

  it("adds the verdict against Lance for phones", () => {
    assert.ok(PANELS);
    const html = renderToStaticMarkup(
      <ResultsTable panels={PANELS} readAt={READ} />
    );
    assert.match(
      html,
      /<th scope="col" class="is-verdict is-rival"><span class="vx-results-subject">Vortex <\/span>vs Lance<\/th>/
    );
    assert.equal(html.match(/<td class="is-verdict is-rival">/g)?.length, 7);
    assert.match(
      html,
      /<th scope="col"><span class="vx-results-label">Benchmark<\/span><span class="vx-results-lead" aria-hidden="true">Vortex<\/span><\/th>/
    );
  });
});
