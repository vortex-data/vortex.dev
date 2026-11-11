import { formatReadDate, type Panel } from "@/lib/bench-summary";
import { baseUrl } from "@/lib/constants";
import { GPU_DETAIL, GPU_PANEL } from "@/lib/gpu-result";
import { copyText, installTabs } from "@/lib/install";
import type { EcosystemEntry } from "@/lib/llms";
import { resultsRow, resultsSystems } from "@/vendor/vortex-design/results.js";

const REPO = "https://github.com/vortex-data/vortex";
const DOCS = "https://docs.vortex.dev";
const BENCH = "https://bench.vortex.dev";

// What each speed panel measures, in a few words, by panel title
// (bench-summary.ts and gpu-result.ts), for the answer that says where
// Vortex is faster. A panel not named here gives its short name.
const WORKLOADS: Record<string, string> = {
  "Scan throughput": "scans",
  "Write throughput": "writes",
  "ClickBench on DataFusion": "queries on CPUs",
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
  const systems = bench ? resultsSystems(bench.panels) : [];
  const verdict = (panel: Panel) => resultsRow(panel, systems).verdict;
  const hasGpu = bench?.panels.some((p) => p.title === GPU_PANEL.title);
  // The tradeoff, with its number, while bench shows Vortex's files larger.
  const size = bench?.panels.find((p) => p.kind === "size");
  const larger = size && /larger$/.test(verdict(size)) ? verdict(size) : null;
  // The speed claim says only what bench's newest verdicts show.
  const speed = bench?.panels.filter((p) => p.kind === "speed") ?? [];
  const workload = (p: Panel) =>
    WORKLOADS[p.title] ?? (p.short ?? p.title).toLowerCase();
  const faster = speed.filter((p) => /faster$/.test(verdict(p))).map(workload);
  const slower = speed.filter((p) => /slower$/.test(verdict(p))).map(workload);
  const shipped = ecosystem.filter((e) => !e.soon).map((e) => e.name);
  const proposed = ecosystem.filter((e) => e.soon).map((e) => e.name);

  return [
    {
      id: "what-is-vortex",
      question: "What is Vortex?",
      answer: [
        "Vortex is an open-source columnar file format. Like Apache Parquet, it stores a table column by column, so a query reads only the columns it needs. Its goals are fast scans, fast random access, and good compression.",
        "Vortex has libraries for Rust, Python, and Java. DuckDB, Apache DataFusion, and Apache Spark can query Vortex files."
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
        list: bench.panels.map((panel) => ({
          label: panel.title,
          text:
            panel.title === GPU_PANEL.title
              ? `${verdict(panel)} (not from bench: see the note below)`
              : verdict(panel)
        }))
      }),
      ...(hasGpu && { after: [GPU_DETAIL] }),
      links: [
        { href: `${BENCH}/`, label: "Every benchmark on bench.vortex.dev" },
        { href: `${BENCH}/methodology`, label: "How the benchmarks run" }
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
                : "For many workloads, yes.",
              `In the benchmarks above, Vortex is faster than Parquet at ${series(faster)}.`,
              ...(slower.length > 0
                ? [`Parquet is faster at ${series(slower)}.`]
                : [])
            ].join(" ")
          : "bench.vortex.dev compares the speed of Vortex and Parquet on each commit. Its newest results show which is faster for your workload.",
        larger
          ? `Parquet still has two advantages. Its files are smaller: on bench's datasets, Vortex files are ${larger} than Parquet files with zstd. More tools also read Parquet today.`
          : "Parquet still has one advantage: more tools read it today.",
        `Where ${larger ? "storage cost or tool support" : "tool support"} matters most, Parquet can still be the better choice.`
      ]
    },
    {
      id: "why-fast",
      question: "Why is Vortex fast?",
      answer: [
        "Vortex separates a column's logical type, such as a string or a 64-bit integer, from the encoding that stores it. Each column gets the encoding that suits its data. Vortex can also apply one encoding on top of another (cascading compression).",
        "Vortex runs filters and other compute on encoded data, often without decompressing the column. It loads a column's statistics only when a query needs them. It converts to and from Apache Arrow without copying."
      ],
      links: [{ href: `${DOCS}/`, label: "The Vortex documentation" }]
    },
    {
      id: "stability",
      question: "Is the Vortex file format stable?",
      answer: [
        "Yes. Each release from 0.36.0 on reads files written by any release from 0.36.0 on. The library APIs can still change between releases."
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
      links: [{ href: `${DOCS}/`, label: "Guides and the API reference" }]
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
        "The code is under the Apache License 2.0, and the documentation is under CC BY 4.0."
      ],
      links: [
        {
          href: `${baseUrl}/charter.pdf`,
          label: "The Vortex Technical Charter"
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
        { href: REPO, label: "Vortex on GitHub" }
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
