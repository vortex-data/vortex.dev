import { formatReadDate, type Panel } from "@/lib/bench-summary";
import { baseUrl } from "@/lib/constants";
import { copyText, installTabs } from "@/lib/install";
import type { EcosystemEntry } from "@/lib/llms";
import { resultsRow, resultsSystems } from "@/vendor/vortex-design/results.js";

const REPO = "https://github.com/vortex-data/vortex";
const DOCS = "https://docs.vortex.dev";
const BENCH = "https://bench.vortex.dev";

/** One item of an answer's list: a figure, or a command when `code` is set. */
type FaqItem = { label: string; text: string; code?: true };

/**
 * One question of /faq. The answer is its paragraphs, then an optional list,
 * then links to read more. Every part is plain text, so the page, the
 * structured data, and llms.txt say the same thing.
 */
export type Faq = {
  id: string;
  question: string;
  answer: string[];
  list?: FaqItem[];
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
  const shipped = ecosystem.filter((e) => !e.soon).map((e) => e.name);
  const proposed = ecosystem.filter((e) => e.soon).map((e) => e.name);

  return [
    {
      id: "what-is-vortex",
      question: "What is Vortex?",
      answer: [
        "Vortex is an open-source columnar file format. Like Apache Parquet, it stores a table column by column, so a query reads only the columns it needs. It is made for fast scans, fast random access, and good compression.",
        "You can use Vortex from Rust, Python, and Java, and query it with DuckDB, Apache DataFusion, and Apache Spark. It is a Linux Foundation project, and its code is under the Apache License 2.0."
      ]
    },
    {
      id: "vortex-vs-parquet",
      question: "How does Vortex compare to Apache Parquet?",
      answer: bench
        ? [
            `These are Vortex's results against Parquet, read from bench.vortex.dev on ${formatReadDate(bench.readAt)}. Each is the newest result on the develop branch of Vortex, except where a source is given.`
          ]
        : [
            "bench.vortex.dev measures Vortex against Parquet and other formats on every commit to Vortex: scan and write speed, query time, random access, and file size."
          ],
      ...(bench && {
        list: bench.panels.map((panel) => ({
          label: panel.title,
          text: `${resultsRow(panel, systems).verdict}${panel.source ? ` (${panel.source.note})` : ""}`
        }))
      }),
      links: [
        { href: `${BENCH}/`, label: "Every benchmark, on bench.vortex.dev" },
        { href: `${BENCH}/methodology`, label: "How the benchmarks run" }
      ]
    },
    {
      id: "when-to-use-vortex",
      question: "Should I use Vortex instead of Parquet?",
      answer: [
        "For almost every workload, yes. Vortex scans, writes, and reads single rows faster than Parquet, and it runs queries faster on both CPUs and GPUs.",
        "Parquet's files are smaller, and more tools read Parquet today. Where storage cost or the widest tool support matters most, Parquet can still be the better choice."
      ]
    },
    {
      id: "why-fast",
      question: "Why is Vortex fast?",
      answer: [
        "Vortex keeps a column's logical type, such as a string or a 64-bit integer, apart from the encoding that stores it. So each column can get the encoding that suits its data, and compression can cascade one encoding into another.",
        "Its compute kernels run on encoded data, so a filter often does not have to decompress a column first. Statistics load lazily, so a query reads only the ones it needs. Vortex converts to and from Apache Arrow without copying."
      ],
      links: [{ href: `${DOCS}/`, label: "The Vortex documentation" }]
    },
    {
      id: "stability",
      question: "Is the Vortex file format stable?",
      answer: [
        "Yes. From release 0.36.0, each release reads files written by any earlier release from 0.36.0 on. The library APIs can still change between releases."
      ]
    },
    {
      id: "install",
      question: "How do I install Vortex?",
      answer: ["Use the command for your language or engine:"],
      list: installTabs(sparkVersion).map((tab) => ({
        label: tab.label,
        text: copyText(tab),
        code: true
      })),
      links: [{ href: `${DOCS}/`, label: "Guides and the API reference" }]
    },
    {
      id: "who-uses-vortex",
      question: "Who uses Vortex?",
      answer: [
        `Companies and projects that use Vortex, or read and write it, include ${series(shipped)}.${proposed.length > 0 ? ` Vortex support in ${series(proposed)} is proposed.` : ""}`
      ]
    },
    {
      id: "governance",
      question: "Who maintains Vortex, and how is it licensed?",
      answer: [
        "Vortex is a project of LF AI & Data, part of the Linux Foundation, and runs under the Vortex Technical Charter. Spiral donated it. Its code is under the Apache License 2.0, and its documentation under CC BY 4.0."
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

/** One answer as plain text: its paragraphs, then its list, one item a line. */
export function answerText(faq: Faq): string {
  return [
    ...faq.answer,
    ...(faq.list ?? []).map((item) => `${item.label}: ${item.text}`)
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
          ...faq.list.map(
            (item) =>
              `- ${item.label}: ${item.code ? `\`${item.text}\`` : item.text}`
          ),
          ""
        ]
      : [])
  ]);
}
