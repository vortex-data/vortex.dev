import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { OpenInNewIcon } from "@/components/icons";
import { ResultsTable } from "@/components/results-table";
import { formatReadDate, panelsFrom } from "@/lib/bench-summary";
import { renderResults } from "@/vendor/vortex-design/results.js";

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")
  ) as Record<string, unknown>;
const PANELS = panelsFrom(fixture("bench-groups.json").groups, {
  Clickbench: fixture("bench-group-clickbench.json"),
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
    const system = renderResults(PANELS, {
      read: formatReadDate(READ),
      icon: renderToStaticMarkup(<OpenInNewIcon />)
    });
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
      "GPU, cuDF",
      "Random access",
      "File size"
    ])
      assert.ok(
        html.includes(`<th scope="row"`) && html.includes(`>${name}`),
        name
      );
    assert.equal(html.match(/<tr><th scope="row"/g)?.length, 6);
    for (const row of html.split('<tr><th scope="row"').slice(1))
      assert.match(row, /is-best/);
  });
});
