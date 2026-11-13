import { formatReadDate, type Panel } from "@/lib/bench-summary";
import type { BlogPostMeta } from "@/lib/blog";
import { baseUrl } from "@/lib/constants";
import { type Faq, faqMarkdown } from "@/lib/faq";
import { copyText, installTabs } from "@/lib/install";
import type { ExternalPost } from "@/lib/posts";
import { resultsRow, resultsSystems } from "@/vendor/vortex-design/results.js";

// What the homepage says Vortex is, for llms.txt and the structured data.
const SUMMARY =
  "Vortex is an open-source columnar file format for fast scans, random access, and compression, with Rust, Python, DuckDB, DataFusion, and Spark support. It is the best file format for almost every workload, and an Apache-2.0 project of the Linux Foundation.";

const REPO = "https://github.com/vortex-data/vortex";
const DOCS = "https://docs.vortex.dev";
const BENCH = "https://bench.vortex.dev";

// The project's own pages elsewhere, so search and answer engines can tie
// them to one entity: the organization's, then the packages'.
const PROFILES = [
  "https://github.com/vortex-data",
  "https://x.com/vortexdotdev",
  "https://lfaidata.foundation/projects/vortex/"
];
const PACKAGES = [
  "https://crates.io/crates/vortex",
  "https://pypi.org/project/vortex-data/",
  "https://central.sonatype.com/namespace/dev.vortex",
  "https://docs.rs/vortex"
];

/** One mark of the homepage's Ecosystem band (`logos.ts`), as text. */
export type EcosystemEntry = {
  name: string;
  href: string;
  soon?: true;
};

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
    case "TPC-H SF10 on DataFusion":
      return panel.unit === "ms"
        ? "the geometric mean time of the 22 TPC-H queries at scale factor 10 on DataFusion, reading files on local NVMe, so lower is better"
        : "the TPC-H queries at scale factor 10 on DataFusion, reading files on local NVMe: the geometric mean of each query's time divided by the fastest format's, so lower is better";
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
 * figures are the table's own labels (results.js).
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
  posts,
  ecosystem = [],
  elsewhere = []
}: {
  bench: { panels: readonly Panel[]; readAt: Date } | null;
  sparkVersion: string | null;
  posts: readonly Pick<BlogPostMeta, "title" | "slugAsParams" | "excerpt">[];
  ecosystem?: readonly EcosystemEntry[];
  elsewhere?: readonly ExternalPost[];
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
  if (ecosystem.length > 0) {
    lines.push(
      "## Adopters and integrations",
      "",
      "The companies and projects in the homepage's Ecosystem band: the adopters of Vortex, and the projects that it works with. Each links to its own page about Vortex where there is one, else to its homepage.",
      "",
      ...ecosystem.map(
        (e) =>
          `- [${e.name}](${e.href})${e.soon ? ": Vortex support is proposed, not shipped" : ""}`
      ),
      ""
    );
  }
  lines.push(
    "## Docs",
    "",
    `- [Questions and answers](${baseUrl}/faq): how Vortex compares to Parquet, why it is fast, who uses it, and how to install it`,
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
    ""
  );
  if (elsewhere.length > 0) {
    lines.push(
      "## Posts on other sites",
      "",
      ...elsewhere.map(
        (p) =>
          `- [${p.title}](${p.url}) (${p.source}, ${p.date.slice(0, 10)}): ${p.summary}`
      ),
      ""
    );
  }
  lines.push(
    "## Optional",
    "",
    `- [Full text of this file and of every post](${baseUrl}/llms-full.txt)`,
    `- [Vortex Technical Charter](${baseUrl}/charter.pdf)`,
    `- [Community Slack](${baseUrl}/slack)`,
    ""
  );
  return lines.join("\n");
}

/**
 * Markdown headings one level deeper per `by`, outside code fences, so a
 * post's sections sit under its own heading in llms-full.txt.
 */
export function demoteHeadings(markdown: string, by: number): string {
  // The open fence, as CommonMark reads one: a run of three or more backticks
  // or tildes. Only a line with a run of the same character, at least as
  // long, and nothing after it but spaces closes it. Any indent is allowed,
  // since a fence in a list item sits deeper than three spaces.
  let fence: string | null = null;
  return markdown
    .split("\n")
    .map((line) => {
      if (fence !== null) {
        const close = /^\s*(`{3,}|~{3,})\s*$/.exec(line)?.[1];
        if (close && close[0] === fence[0] && close.length >= fence.length)
          fence = null;
        return line;
      }
      const open = /^\s*(`{3,}(?=[^`]*$)|~{3,})/.exec(line)?.[1];
      if (open) {
        fence = open;
        return line;
      }
      if (/^#{1,6} /.test(line)) return `${"#".repeat(by)}${line}`;
      return line;
    })
    .join("\n");
}

/**
 * vortex.dev/llms-full.txt: llms.txt, then the questions and answers of
 * /faq when given, then the full Markdown of each of the site's own posts
 * under its title, date and authors.
 */
export function siteLlmsFullText(
  args: Omit<Parameters<typeof siteLlmsText>[0], "posts"> & {
    posts: readonly Pick<
      BlogPostMeta,
      "title" | "slugAsParams" | "excerpt" | "date" | "authors" | "raw"
    >[];
    faq?: readonly Faq[];
  }
): string {
  const lines = [siteLlmsText(args).trimEnd(), ""];
  if (args.faq)
    lines.push("## Questions and answers", "", ...faqMarkdown(args.faq));
  lines.push("## Posts in full", "");
  for (const post of args.posts) {
    lines.push(
      `### ${post.title}`,
      "",
      `${baseUrl}/blog/${post.slugAsParams}, ${post.date.slice(0, 10)}, by ${post.authors.join(", ")}`,
      "",
      demoteHeadings(post.raw.trim(), 3),
      ""
    );
  }
  return lines.join("\n");
}

/**
 * The homepage's structured data: the site, the organization behind the
 * project, and the project as schema.org SoftwareSourceCode. `sameAs` ties
 * the organization to its profiles and the project to its packages, so
 * search and answer engines read them as one entity.
 */
export function homeJsonLd(): Record<string, unknown> {
  const organization = {
    "@type": "Organization",
    "@id": `${baseUrl}/#organization`,
    name: "Vortex",
    url: baseUrl,
    logo: `${baseUrl}/favicon.ico`,
    slogan: "The frontier file format",
    sameAs: PROFILES,
    parentOrganization: {
      "@type": "Organization",
      name: "The Linux Foundation",
      url: "https://www.linuxfoundation.org"
    }
  };
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${baseUrl}/#website`,
        name: "Vortex",
        alternateName: ["vortex.dev", "Vortex file format"],
        url: baseUrl,
        description: SUMMARY,
        inLanguage: "en",
        publisher: { "@id": `${baseUrl}/#organization` }
      },
      organization,
      {
        "@type": "SoftwareSourceCode",
        "@id": `${baseUrl}/#software`,
        name: "Vortex",
        alternateName: ["Vortex file format", "vortex-data"],
        description: SUMMARY,
        url: baseUrl,
        codeRepository: REPO,
        license: "https://www.apache.org/licenses/LICENSE-2.0",
        programmingLanguage: ["Rust", "Python", "Java"],
        runtimePlatform: ["DuckDB", "DataFusion", "Apache Spark"],
        keywords: [
          "columnar file format",
          "Apache Parquet alternative",
          "Apache Arrow",
          "compression",
          "random access",
          "GPU analytics"
        ],
        publisher: { "@id": `${baseUrl}/#organization` },
        sameAs: [DOCS, BENCH, ...PACKAGES]
      }
    ]
  };
}

/**
 * A post's structured data: the Article, tied to the homepage's
 * organization, and its breadcrumb. An author that is a team rather than a
 * person ("Community Team") is the organization.
 */
export function postJsonLd(post: {
  slugAsParams: string;
  title: string;
  excerpt?: string | null | undefined;
  date: string;
  authors: readonly string[];
}): Record<string, unknown> {
  const url = `${baseUrl}/blog/${post.slugAsParams}`;
  const organization = { "@id": `${baseUrl}/#organization` };
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BlogPosting",
        "@id": `${url}#article`,
        headline: post.title,
        description: post.excerpt ?? undefined,
        datePublished: post.date,
        author: post.authors.map((name) =>
          /\bteam\b/i.test(name)
            ? { "@type": "Organization", name: `Vortex ${name}`, url: baseUrl }
            : { "@type": "Person", name }
        ),
        publisher: {
          ...organization,
          "@type": "Organization",
          name: "Vortex",
          url: baseUrl,
          logo: `${baseUrl}/favicon.ico`
        },
        isPartOf: {
          "@type": "Blog",
          "@id": `${baseUrl}/blog#blog`,
          name: "Vortex Blog",
          url: `${baseUrl}/blog`
        },
        about: { "@id": `${baseUrl}/#software` },
        inLanguage: "en",
        license: "https://creativecommons.org/licenses/by/4.0/",
        mainEntityOfPage: { "@type": "WebPage", "@id": url },
        image: `${url}/opengraph-image`
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Vortex", item: baseUrl },
          {
            "@type": "ListItem",
            position: 2,
            name: "Blog",
            item: `${baseUrl}/blog`
          },
          { "@type": "ListItem", position: 3, name: post.title, item: url }
        ]
      }
    ]
  };
}
