import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { panelsFrom } from "@/lib/bench-summary";
import { defined } from "@/lib/defined";
import {
  demoteHeadings,
  homeJsonLd,
  postJsonLd,
  resultsSentences,
  siteLlmsFullText,
  siteLlmsText
} from "@/lib/llms";

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
const posts = [
  { title: "A post", slugAsParams: "a-post", excerpt: "What it says." }
] as unknown as Parameters<typeof siteLlmsText>[0]["posts"];

describe("resultsSentences", () => {
  it("says what each row measures, its figures, and the verdict", () => {
    assert.ok(PANELS);
    const sentences = resultsSentences(PANELS);
    assert.equal(sentences.length, 7);
    for (const s of sentences) assert.match(s, /Vortex against Parquet: .+\.$/);
    assert.match(sentences[0] ?? "", /^Scan, how fast each format scans/);
    assert.match(
      sentences[3] ?? "",
      /^TPC-H, the geometric mean time of the 22/
    );
    assert.match(sentences[4] ?? "", /^GPU, cuDF, query time on a GPU in cuDF/);
    // Lance cannot run in cuDF, and the sentence says why, not a figure.
    assert.match(
      sentences[4] ?? "",
      /Lance not available, no cuDF integration/
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

  it("lists the ecosystem and says which support is only proposed", () => {
    const text = siteLlmsText({
      bench: null,
      sparkVersion: null,
      posts,
      ecosystem: [
        { name: "DuckDB", href: "https://duckdb.org" },
        {
          name: "Apache Iceberg",
          href: "https://iceberg.apache.org",
          soon: true
        }
      ]
    });
    assert.ok(text.includes("\n## Adopters and integrations\n"));
    assert.ok(text.includes("- [DuckDB](https://duckdb.org)\n"));
    assert.ok(
      text.includes(
        "- [Apache Iceberg](https://iceberg.apache.org): Vortex support is proposed, not shipped"
      )
    );
  });

  it("links the posts on other sites with their source and date", () => {
    const text = siteLlmsText({
      bench: null,
      sparkVersion: null,
      posts,
      elsewhere: [
        {
          title: "Elsewhere",
          url: "https://example.com/post",
          date: "2026-10-21T12:00:00.000Z",
          source: "example.com",
          authors: ["A. Writer"],
          summary: "What it says."
        }
      ]
    });
    assert.ok(
      text.includes(
        "- [Elsewhere](https://example.com/post) (example.com, 2026-10-21): What it says."
      )
    );
    assert.ok(text.includes("/llms-full.txt)"));
  });
});

describe("demoteHeadings", () => {
  it("demotes headings outside code fences only", () => {
    assert.equal(
      demoteHeadings("## A\n```sh\n# not a heading\n```\n### B", 2),
      "#### A\n```sh\n# not a heading\n```\n##### B"
    );
  });

  it("closes a fence only on a run as long, with nothing after it", () => {
    const quoted = "````md\n```\n# still code\n```example\n# code\n````\n# A";
    assert.equal(
      demoteHeadings(quoted, 1),
      "````md\n```\n# still code\n```example\n# code\n````\n## A"
    );
    assert.equal(
      demoteHeadings("~~~\n```\n# code\n~~~~\n# A", 1),
      "~~~\n```\n# code\n~~~~\n## A"
    );
  });
});

describe("siteLlmsFullText", () => {
  it("starts with llms.txt and gives each post in full under its title", () => {
    const full = siteLlmsFullText({
      bench: null,
      sparkVersion: null,
      posts: [
        {
          title: "A post",
          slugAsParams: "a-post",
          excerpt: "What it says.",
          date: "2026-02-26T00:00:00.000Z",
          authors: ["A. Writer"],
          raw: "Intro.\n\n## A section\n\nBody."
        }
      ]
    });
    assert.ok(full.startsWith("# Vortex\n"));
    assert.ok(full.includes("\n## Posts in full\n\n### A post\n"));
    assert.ok(full.includes("/blog/a-post, 2026-02-26, by A. Writer"));
    assert.ok(full.includes("\n##### A section\n"));
  });
});

describe("homeJsonLd", () => {
  it("describes the site, the project, and the organization behind it", () => {
    const graph = homeJsonLd()["@graph"] as Record<string, unknown>[];
    assert.deepEqual(
      graph.map((node) => node["@type"]),
      ["WebSite", "Organization", "SoftwareSourceCode"]
    );
    assert.equal(
      graph[2]?.codeRepository,
      "https://github.com/vortex-data/vortex"
    );
    assert.deepEqual(
      (defined(graph[2]).sameAs as string[]).map((url) => new URL(url).host),
      [
        "docs.vortex.dev",
        "bench.vortex.dev",
        "crates.io",
        "pypi.org",
        "central.sonatype.com",
        "docs.rs"
      ]
    );
  });
});

describe("postJsonLd", () => {
  const graph = (authors: string[]) =>
    postJsonLd({
      slugAsParams: "a-post",
      title: "A post",
      excerpt: "What it says.",
      date: "2026-02-26",
      authors
    })["@graph"] as Record<string, unknown>[];

  it("gives the post and its breadcrumb", () => {
    const [article, crumbs] = graph(["Nicholas Gates"]);
    assert.equal(article?.["@type"], "BlogPosting");
    assert.deepEqual(article?.author, [
      { "@type": "Person", name: "Nicholas Gates" }
    ]);
    assert.equal(crumbs?.["@type"], "BreadcrumbList");
  });

  it("names a team author as an organization, not a person", () => {
    const [article] = graph(["Community Team"]);
    assert.equal(
      (defined(article).author as Record<string, unknown>[])[0]?.["@type"],
      "Organization"
    );
  });
});
