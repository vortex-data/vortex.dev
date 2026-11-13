import { benchHref } from "@/lib/bench-link";
import { formatReadDate, type Panel } from "@/lib/bench-summary";
import { baseUrl } from "@/lib/constants";
import { GPU_DETAIL, GPU_PANEL } from "@/lib/gpu-result";
import { copyText, installTabs } from "@/lib/install";
import type { EcosystemEntry } from "@/lib/llms";
import {
  panelVerdict,
  resultsRow,
  resultsSystems,
  versusParquet
} from "@/vendor/vortex-design/results.js";

const REPO = "https://github.com/vortex-data/vortex";
const DOCS = "https://docs.vortex.dev";

// What each speed panel measures, in a few words, by panel title
// (bench-summary.ts and gpu-result.ts), for the answer that says where
// Vortex is faster. A panel not named here gives its short name.
const WORKLOADS: Record<string, string> = {
  "Scan throughput": "scans",
  "Write throughput": "writes",
  "ClickBench on DataFusion": "ClickBench queries",
  "TPC-H SF10 on DataFusion": "TPC-H queries",
  "GPU analytics with cuDF": "queries on GPUs",
  "Random access, NVMe, hot": "single-row reads"
};

/**
 * One item of an answer's list: a name, a figure (`text`), or a command when
 * `code` is set.
 */
type FaqItem = { label: string; text?: string; code?: true };

/**
 * One question of /faq. The answer is its paragraphs, then an optional list,
 * the paragraphs after the list, and links to read more. Every part is plain
 * text, so the page, the structured data, and llms.txt say the same thing.
 */
export type Faq = {
  id: string;
  question: string;
  answer: string[];
  list?: FaqItem[];
  after?: string[];
  links?: { href: string; label: string }[];
};

// The table formats in the Ecosystem band, for the answer on Lance.
const TABLE_FORMATS = ["Apache Iceberg", "Apache Hudi", "Apache Paimon"];

/**
 * Vortex against Lance in a panel, in the words the table uses against
 * Parquet ("14× faster", "48% smaller"), or "Lance not measured". `null`
 * when the panel does not run Lance, as for the GPU result.
 */
function versusLance(panel: Panel): string | null {
  const lance = panel.rows.find((r) => r.system === "Lance");
  if (!panel.systems?.includes("Lance") || !lance || lance.unavailable)
    return null;
  // results.js compares Vortex with the row named Parquet, so Lance's row
  // takes that name.
  const rows = panel.rows
    .filter((r) => r.system !== "Parquet")
    .map((r) => (r === lance ? { ...r, system: "Parquet" } : r));
  const vs = versusParquet(rows, panel.better);
  if (vs.vortexWins === null || vs.vortexWins === undefined)
    return `${vs.missing === "Parquet" ? "Lance" : "Vortex"} not measured`;
  return panelVerdict(panel.kind, vs);
}

/** "a, b, and c", with the serial comma. */
function series(items: readonly string[]): string {
  if (items.length < 3) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

/**
 * The questions on vortex.dev/faq. The comparison with Parquet comes from
 * the homepage's figures (`bench`), so it never says a number bench no
 * longer shows; without them it points to bench. The adopters come from the
 * homepage's Ecosystem band (`ecosystem`), and the install commands from its
 * InstallTabs.
 */
export function faqs({
  bench,
  sparkVersion,
  ecosystem
}: {
  bench: { panels: readonly Panel[]; readAt: Date } | null;
  sparkVersion: string | null;
  ecosystem: readonly EcosystemEntry[];
}): Faq[] {
  const compared = bench?.panels ?? [];
  const systems = resultsSystems(compared);
  const verdict = (panel: Panel) => resultsRow(panel, systems).verdict;
  const hasGpu = compared.some((p) => p.title === GPU_PANEL.title);
  // The size tradeoff, with its number, while bench shows Vortex's files
  // larger. Only a measured "smaller" or "the same size" drops it; without a
  // measured verdict the answer leaves file size open.
  const size = compared.find((p) => p.kind === "size");
  const sizeVerdict = size ? verdict(size) : null;
  const larger =
    sizeVerdict && /larger$/.test(sizeVerdict) ? sizeVerdict : null;
  const notLarger =
    sizeVerdict !== null && /smaller$|^the same size$/.test(sizeVerdict);
  // The speed claim says only what bench's newest verdicts show.
  const speed = compared.filter((p) => p.kind === "speed");
  const workload = (p: Panel) =>
    WORKLOADS[p.title] ?? (p.short ?? p.title).toLowerCase();
  const faster = speed.filter((p) => /faster$/.test(verdict(p))).map(workload);
  const slower = speed.filter((p) => /slower$/.test(verdict(p))).map(workload);
  const shipped = ecosystem.filter((e) => !e.soon).map((e) => e.name);
  const proposed = ecosystem.filter((e) => e.soon).map((e) => e.name);
  // Vortex against Lance in each panel that runs Lance. The lead-in says
  // Vortex wins only while every speed verdict says faster and the size
  // verdict says smaller.
  const lance = compared.flatMap((panel) => {
    const text = versusLance(panel);
    const label = panel.kind === "size" ? "File size" : panel.title;
    return text === null ? [] : [{ label, text }];
  });
  const lanceWins =
    lance.some((i) => i.label === "File size") &&
    lance.every((i) =>
      i.label === "File size" ? /smaller$/.test(i.text) : /faster$/.test(i.text)
    );
  const tables = (names: string[]) =>
    names.filter((n) => TABLE_FORMATS.includes(n));
  const [shippedTables, proposedTables] = [tables(shipped), tables(proposed)];

  return [
    {
      id: "what-is-vortex",
      question: "What is Vortex?",
      answer: [
        "Vortex is an open-source columnar file format. Like Apache Parquet, it stores a table column by column, so a query reads only the columns it needs. Its goals are fast scans, fast random access, and good compression.",
        "Vortex has libraries for Rust, Python, Java, C, and C++. DuckDB, Apache DataFusion, Apache Spark, and Ray can query Vortex files, and Pandas, Polars, and PyArrow can read them through the Python library."
      ],
      links: [
        { href: `${DOCS}/getting-started/`, label: "The quickstart" },
        { href: `${DOCS}/user-guide/`, label: "Guides for each engine" }
      ]
    },
    {
      id: "vortex-vs-parquet",
      question: "How does Vortex compare to Apache Parquet?",
      answer: bench
        ? [
            `bench.vortex.dev runs these public benchmarks on each commit to the develop branch of Vortex. Its newest results against Parquet, read on ${formatReadDate(bench.readAt)}:`
          ]
        : [
            "bench.vortex.dev measures Vortex against Parquet and other formats on each commit to Vortex. It measures scan and write speed, query time, random access, and file size."
          ],
      ...(bench && {
        list: compared.map((panel) => ({
          label: panel.title,
          text:
            panel.title === GPU_PANEL.title
              ? `${verdict(panel)} (not from bench: see the note below)`
              : verdict(panel)
        }))
      }),
      ...(hasGpu && { after: [GPU_DETAIL] }),
      links: [
        { href: benchHref("/"), label: "Every benchmark on bench.vortex.dev" },
        { href: benchHref("/methodology"), label: "How the benchmarks run" }
      ]
    },
    {
      id: "when-to-use-vortex",
      question: "Should I use Vortex instead of Parquet?",
      answer: [
        faster.length > 0
          ? [
              faster.length === speed.length
                ? "For almost every workload, yes."
                : faster.length > speed.length / 2
                  ? "For most workloads, yes."
                  : "It depends on the workload.",
              `In the benchmarks above, Vortex is faster than Parquet at ${series(faster)}.`,
              ...(slower.length > 0
                ? [`Parquet is faster at ${series(slower)}.`]
                : [])
            ].join(" ")
          : "bench.vortex.dev compares the speed of Vortex and Parquet on each commit. Its newest results show which is faster for your workload.",
        larger
          ? `Parquet still has two advantages. Its files are smaller: on bench's datasets, Vortex files are ${larger} than Parquet files with zstd. More tools also read Parquet today.`
          : notLarger
            ? "Parquet still has one advantage: more tools read it today."
            : "More tools read Parquet today. For file size, see bench.vortex.dev's newest results.",
        `Where ${notLarger ? "tool support" : "storage cost or tool support"} matters most, Parquet can still be the better choice.`
      ]
    },
    {
      id: "vortex-vs-lance",
      question: "How does Vortex compare to Lance?",
      answer: [
        "Lance is a table format and a file format with the same name. The Lance table format keeps versions of a table and supports secondary indexes, vector indexes among them. It is an alternative to lakehouse table formats such as Apache Iceberg and Delta Lake.",
        [
          "Vortex, like Parquet, is only a file format. A Vortex file can hold its own indexes. By default it keeps zone maps (statistics on blocks of rows), so a scan skips blocks that cannot match its filter. A custom layout can add other indexes. Indexes outside the file, such as a vector index over a whole table, and table versions are a table format's job.",
          ...(shippedTables.length > 0
            ? [`${series(shippedTables)} can store tables in Vortex files.`]
            : []),
          ...(proposedTables.length > 0
            ? [
                `${series(proposedTables)} ${proposedTables.length > 1 ? "have proposals" : "has a proposal"} to store tables in Vortex files.`
              ]
            : [])
        ].join(" "),
        bench && lance.length > 0
          ? lanceWins
            ? `On bench.vortex.dev's newest results, read on ${formatReadDate(bench.readAt)}, Vortex is faster than Lance in every benchmark that runs both, and its files are smaller:`
            : `bench.vortex.dev's newest results against Lance, read on ${formatReadDate(bench.readAt)}:`
          : "bench.vortex.dev also measures Vortex against Lance on each commit to Vortex."
      ],
      ...(bench && lance.length > 0 && { list: lance }),
      after: [
        "Both formats are under the Apache License 2.0. Vortex is a Linux Foundation project. LF Projects, part of the Linux Foundation, holds the Vortex trademark, and the charter keeps the project's code under the Apache License. Changing the charter takes a two-thirds vote of the Technical Steering Committee and the approval of LF Projects. Lance has its own governance, but the name and code are held by a private company (LanceDB) instead of an independent foundation."
      ],
      links: [
        { href: benchHref("/"), label: "Every benchmark on bench.vortex.dev" },
        {
          href: `${baseUrl}/charter.pdf`,
          label: "The Vortex Technical Charter"
        }
      ]
    },
    {
      id: "why-fast",
      question: "Why is Vortex fast?",
      answer: [
        "Vortex separates a column's logical type, such as a string or a 64-bit integer, from the encoding that stores it. Each column gets the encoding that suits its data. Vortex can also apply one encoding on top of another (cascading compression).",
        "Vortex runs filters and other compute on encoded data, often without decompressing the column. It loads a column's statistics only when a query needs them. It converts to and from Apache Arrow without copying."
      ],
      links: [
        { href: `${DOCS}/concepts/`, label: "Vortex's concepts" },
        {
          href: `${DOCS}/developer-guide/internals/stats-pruning`,
          label: "How statistics prune a scan"
        }
      ]
    },
    {
      id: "stability",
      question: "Is the Vortex file format stable?",
      answer: [
        "Yes. From release 0.36.0, each release reads the files that any earlier release from 0.36.0 on wrote. For an older release to read a newer release's files, the writer targets an edition (a named set of wire formats) that the older release supports. The library APIs can still change between releases."
      ],
      links: [
        {
          href: `${DOCS}/specs/versioning`,
          label: "Versioning and compatibility"
        }
      ]
    },
    {
      id: "install",
      question: "How do I install Vortex?",
      answer: ["Run the command for your language or engine:"],
      list: installTabs(sparkVersion).map((tab) => ({
        label: tab.label,
        text: copyText(tab),
        code: true
      })),
      links: [
        {
          href: `${DOCS}/getting-started/install`,
          label: "Install the vx CLI"
        },
        {
          href: `${DOCS}/getting-started/`,
          label: "Quickstarts for each language"
        }
      ]
    },
    {
      id: "who-uses-vortex",
      question: "Who uses Vortex, and what does it work with?",
      answer: [
        "The adopters of Vortex, and the projects that it works with, include:"
      ],
      list: shipped.map((name) => ({ label: name })),
      ...(proposed.length > 0 && {
        after: [
          `${series(proposed)} ${proposed.length > 1 ? "have proposals" : "has a proposal"} to add Vortex support.`
        ]
      })
    },
    {
      id: "governance",
      question: "Who maintains Vortex, and how is it licensed?",
      answer: [
        "Vortex is a project of LF AI & Data, the part of the Linux Foundation for AI and data projects. The Vortex Technical Charter governs it. Spiral donated Vortex to the Linux Foundation.",
        "Vortex has committers and maintainers who are affiliated with organizations that include Microsoft, Dash0, Firebolt, ClickHouse, Kenn Software, Carnegie Mellon University, CWI, and Tsinghua University.",
        "The code is under the Apache License 2.0, and the documentation is under CC BY 4.0."
      ],
      links: [
        {
          href: `${baseUrl}/charter.pdf`,
          label: "The Vortex Technical Charter"
        },
        {
          href: "https://www.linuxfoundation.org/press/lf-ai-data-foundation-hosts-vortex-project-to-power-high-performance-data-access-for-ai-and-analytics",
          label: "The LF AI & Data announcement"
        },
        {
          href: "https://spiraldb.com/blog/vortex-a-linux-foundation-project",
          label: "Spiral's post on donating Vortex"
        }
      ]
    },
    {
      id: "help",
      question: "How do I get help or contribute?",
      answer: [
        "Ask in the community Slack, or open an issue or a pull request on GitHub."
      ],
      links: [
        { href: `${baseUrl}/slack`, label: "Join the Slack" },
        { href: REPO, label: "Vortex on GitHub" },
        { href: `${DOCS}/project/contributing`, label: "How to contribute" }
      ]
    }
  ];
}

/** One list item as text: "label: text", or the label alone. */
function itemText(item: FaqItem): string {
  return item.text ? `${item.label}: ${item.text}` : item.label;
}

/**
 * One answer as plain text: its paragraphs, its list one item a line, then
 * the paragraphs after the list.
 */
export function answerText(faq: Faq): string {
  return [
    ...faq.answer,
    ...(faq.list ?? []).map(itemText),
    ...(faq.after ?? [])
  ].join("\n");
}

/** The FAQ as schema.org FAQPage, for the page's structured data. */
export function faqJsonLd(list: readonly Faq[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${baseUrl}/faq#faq`,
    url: `${baseUrl}/faq`,
    isPartOf: { "@id": `${baseUrl}/#website` },
    about: { "@id": `${baseUrl}/#software` },
    mainEntity: list.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: answerText(faq) }
    }))
  };
}

/** The FAQ as Markdown, for llms.txt: a heading per question. */
export function faqMarkdown(list: readonly Faq[]): string[] {
  return list.flatMap((faq) => [
    `### ${faq.question}`,
    "",
    ...faq.answer.flatMap((p) => [p, ""]),
    ...(faq.list
      ? [
          ...faq.list.map((item) =>
            item.code
              ? `- ${item.label}: \`${item.text}\``
              : `- ${itemText(item)}`
          ),
          ""
        ]
      : []),
    ...(faq.after ?? []).flatMap((p) => [p, ""])
  ]);
}
