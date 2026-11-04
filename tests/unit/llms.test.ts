import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { panelsFrom } from "@/lib/bench-summary";
import { homeJsonLd, resultsSentences, siteLlmsText } from "@/lib/llms";

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")
  ) as Record<string, unknown>;
const PANELS = panelsFrom(fixture("bench-groups.json").groups, {
  Clickbench: fixture("bench-group-clickbench.json"),
  "Random Access (NVMe)": fixture("bench-group-random-access-nvme.json")
});
const READ = new Date("2026-11-02T12:00:00Z");
const posts = [
  { title: "A post", slugAsParams: "a-post", excerpt: "What it says." }
] as unknown as Parameters<typeof siteLlmsText>[0]["posts"];

describe("resultsSentences", () => {
  it("says what each row measures, its figures, and the verdict", () => {
    assert.ok(PANELS);
    const sentences = resultsSentences(PANELS);
    assert.equal(sentences.length, 6);
    for (const s of sentences) assert.match(s, /Vortex against Parquet: .+\.$/);
    assert.match(sentences[0] ?? "", /^Scan, how fast each format scans/);
    assert.match(sentences[3] ?? "", /^GPU, cuDF, query time on a GPU in cuDF/);
    // Lance cannot run in cuDF, and the sentence says why, not a figure.
    assert.match(
      sentences[3] ?? "",
      /Lance not available, no cuDF integration/
    );
  });

  it("gives the file-size spread the table's foot gives", () => {
    assert.ok(PANELS);
    const size = resultsSentences(PANELS).find((s) =>
      s.startsWith("File size")
    );
    assert.match(
      size ?? "",
      /Vortex against Parquet: .+\. File size: geomean of bench’s datasets, from 0\.551× to 1\.46× Parquet\+zstd\.$/
    );
  });
});

describe("siteLlmsText", () => {
  it("follows llms.txt: a title, a summary quote, then sections", () => {
    const text = siteLlmsText({ bench: null, sparkVersion: null, posts });
    assert.ok(text.startsWith("# Vortex\n\n> Vortex is an open-source"));
    for (const h of ["## Install", "## Docs", "## Blog", "## Optional"])
      assert.ok(text.includes(`\n${h}\n`), h);
  });

  it("dates the results and leaves them out when bench cannot be read", () => {
    assert.ok(PANELS);
    const text = siteLlmsText({
      bench: { panels: PANELS, readAt: READ },
      sparkVersion: "0.1.0",
      posts
    });
    assert.ok(text.includes("on 2 Nov 2026."));
    assert.ok(text.includes("- Spark: `implementation"));
    assert.ok(
      !siteLlmsText({ bench: null, sparkVersion: null, posts }).includes(
        "## Benchmark results"
      )
    );
  });

  it("links the posts", () => {
    const text = siteLlmsText({ bench: null, sparkVersion: null, posts });
    assert.ok(text.includes("/blog/a-post): What it says."));
  });
});

describe("homeJsonLd", () => {
  it("describes the project and the organization that publishes it", () => {
    const graph = homeJsonLd()["@graph"] as Record<string, unknown>[];
    assert.deepEqual(
      graph.map((node) => node["@type"]),
      ["Organization", "SoftwareSourceCode"]
    );
    assert.equal(
      graph[1]?.codeRepository,
      "https://github.com/vortex-data/vortex"
    );
  });
});
