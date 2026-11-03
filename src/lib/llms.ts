import { formatReadDate, type Panel } from "@/lib/bench-summary";
import type { BlogPostMeta } from "@/lib/blog";
import { baseUrl } from "@/lib/constants";
import { copyText, installTabs } from "@/lib/install";
import {
  resultsRow,
  resultsSystems
} from "@/vendor/vortex-design/benchmark-card.js";

// What the homepage says Vortex is, for llms.txt and the structured data.
export const SUMMARY =
  "Vortex is an open-source columnar file format for fast scans, random access, and compression, with Rust, Python, DuckDB, DataFusion, and Spark support. It is an Apache-2.0 project of the Linux Foundation.";

const REPO = "https://github.com/vortex-data/vortex";
const DOCS = "https://docs.vortex.dev";
const BENCH = "https://bench.vortex.dev";

/**
 * What each row of the homepage's results table measures, by panel title
 * (bench-summary.ts and gpu-result.ts). A time panel that fell back to
 * bench's scores (`× fastest`) says so.
 */
function about(panel: Panel): string {
  switch (panel.title) {
    case "Scan throughput":
      return "how fast each format scans the compression benchmark's datasets: the geometric mean of its throughput divided by Parquet's, so higher is better";
    case "Write throughput":
      return "how fast each format writes the compression benchmark's datasets: the geometric mean of its throughput divided by Parquet's, so higher is better";
    case "ClickBench on DataFusion":
      return panel.unit === "ms"
        ? "the geometric mean time of the ClickBench queries on DataFusion, reading files on local NVMe, so lower is better"
        : "the ClickBench queries on DataFusion, reading files on local NVMe: the geometric mean of each query's time divided by the fastest format's, so lower is better";
    case "Random access, NVMe, hot":
      return panel.unit === "ms"
        ? "the geometric mean time to take rows from each of the random access benchmark's datasets on local NVMe, reusing an open file, so lower is better"
        : "taking rows from the random access benchmark's datasets on local NVMe, reusing an open file: the geometric mean of each dataset's time divided by the fastest format's, so lower is better";
    case "GPU analytics with cuDF":
      return `query time on a GPU in cuDF, so lower is better (${panel.source?.note ?? "not from bench"})`;
    case "Size vs Parquet+Zstd":
      return "the geometric mean of each format's file size divided by Parquet's with zstd, over the compression benchmark's datasets, so smaller is better";
    default:
      return panel.source
        ? `${panel.title}: ${panel.source.note}`
        : panel.title;
  }
}

/**
 * The homepage's results table as sentences, one per row: what the row
 * measures, each format's figure, and how Vortex does against Parquet. The
 * figures are the table's own labels (benchmark-card.js).
 */
export function resultsSentences(panels: readonly Panel[]): string[] {
  const systems = resultsSystems(panels);
  return panels.map((panel) => {
    const row = resultsRow(panel, systems);
    const figures = row.cells
      .filter((c) => c.state !== "not-run")
      .map((c) => `${c.system} ${c.state === "measured" ? c.label : c.exact}`)
      .join(", ");
    return `${row.name}, ${about(panel)}: ${figures}. Vortex against Parquet: ${row.verdict}.`;
  });
}

/**
 * vortex.dev's llms.txt (https://llmstxt.org): what Vortex is, how to
 * install it, its headline results with their date, and links to the docs,
 * bench, and the posts. `bench` is the homepage's figures, or `null` when
 * bench could not be read.
 */
export function siteLlmsText({
  bench,
  sparkVersion,
  posts
}: {
  bench: { panels: readonly Panel[]; readAt: Date } | null;
  sparkVersion: string | null;
  posts: readonly BlogPostMeta[];
}): string {
  const lines = [
    "# Vortex",
    "",
    `> ${SUMMARY}`,
    "",
    "Vortex keeps a column's logical type apart from its physical encoding. Its encodings, compression, and layouts are pluggable, compression can cascade one encoding into another, compute kernels run on encoded data, and statistics load lazily. It converts to and from Apache Arrow without copying, and works with DataFusion, DuckDB, Spark, Pandas, and Polars.",
    "",
    "The file format is stable: from release 0.36.0, each release reads files written by any earlier release from 0.36.0 on. Library APIs can still change between releases.",
    "",
    "Governance: Vortex is a Linux Foundation project (LF AI & Data) under the Vortex Technical Charter. Its code is Apache-2.0 and its documentation is CC-BY-4.0.",
    "",
    "## Install",
    "",
    ...installTabs(sparkVersion).flatMap((tab) => [
      `- ${tab.label}: \`${copyText(tab)}\``
    ]),
    ""
  ];
  if (bench) {
    lines.push(
      "## Benchmark results",
      "",
      `Read from ${BENCH} on ${formatReadDate(bench.readAt)}. Each figure is the newest result on the develop branch of ${REPO}, except the GPU row, whose source is given. ${BENCH}/llms.txt summarizes every benchmark group, and ${BENCH}/methodology says how they run.`,
      "",
      ...resultsSentences(bench.panels).map((s) => `- ${s}`),
      ""
    );
  }
  lines.push(
    "## Docs",
    "",
    `- [Documentation](${DOCS}/): guides, concepts, and the API reference`,
    `- [Documentation index for language models](${DOCS}/llms.txt)`,
    `- [Benchmarks](${BENCH}/): every result, charted over recent commits`,
    `- [Benchmark summaries as text](${BENCH}/llms.txt): every group's rankings, with links to each chart`,
    `- [Source code](${REPO})`,
    "",
    "## Blog",
    "",
    ...posts.map(
      (post) =>
        `- [${post.title}](${baseUrl}/blog/${post.slugAsParams})${post.excerpt ? `: ${post.excerpt}` : ""}`
    ),
    "",
    "## Optional",
    "",
    `- [Vortex Technical Charter](${baseUrl}/charter.pdf)`,
    `- [Community Slack](${baseUrl}/slack)`,
    ""
  );
  return lines.join("\n");
}

/**
 * The homepage's structured data: the project as schema.org
 * SoftwareSourceCode, and the organization behind it.
 */
export function homeJsonLd(): Record<string, unknown> {
  const organization = {
    "@type": "Organization",
    "@id": `${baseUrl}/#organization`,
    name: "Vortex",
    url: baseUrl,
    logo: `${baseUrl}/favicon.ico`,
    sameAs: [REPO],
    parentOrganization: {
      "@type": "Organization",
      name: "The Linux Foundation",
      url: "https://www.linuxfoundation.org"
    }
  };
  return {
    "@context": "https://schema.org",
    "@graph": [
      organization,
      {
        "@type": "SoftwareSourceCode",
        name: "Vortex",
        description: SUMMARY,
        url: baseUrl,
        codeRepository: REPO,
        license: "https://www.apache.org/licenses/LICENSE-2.0",
        programmingLanguage: ["Rust", "Python", "Java"],
        runtimePlatform: ["DuckDB", "DataFusion", "Apache Spark"],
        keywords: [
          "columnar file format",
          "Apache Arrow",
          "Apache Parquet",
          "compression",
          "random access"
        ],
        publisher: { "@id": `${baseUrl}/#organization` },
        sameAs: [DOCS, BENCH]
      }
    ]
  };
}
