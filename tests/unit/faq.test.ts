import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { panelsFrom } from "@/lib/bench-summary";
import { defined } from "@/lib/defined";
import { answerText, faqJsonLd, faqMarkdown, faqs } from "@/lib/faq";
import { GPU_DETAIL } from "@/lib/gpu-result";
import { siteLlmsFullText, siteLlmsText } from "@/lib/llms";
import { resultsRow, resultsSystems } from "@/vendor/vortex-design/results.js";

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")
  ) as Record<string, unknown>;
const PANELS = defined(
  panelsFrom(fixture("bench-groups.json").groups, {
    Clickbench: fixture("bench-group-clickbench.json"),
    "Random Access (NVMe)": fixture("bench-group-random-access-nvme.json")
  })
);
const ECOSYSTEM = [
  { name: "Acme", href: "https://acme.example" },
  { name: "Apache Thing", href: "https://thing.example" },
  { name: "Initech", href: "https://initech.example" },
  { name: "Apache Later", href: "https://later.example", soon: true as const }
];
const READ = new Date("2026-11-02T12:00:00Z");
const byId = (list: ReturnType<typeof faqs>, id: string) =>
  defined(list.find((f) => f.id === id));

describe("faqs", () => {
  const list = faqs({
    bench: { panels: PANELS, readAt: READ },
    sparkVersion: "0.40.0",
    ecosystem: ECOSYSTEM
  });

  it("gives each question its own anchor", () => {
    const ids = list.map((f) => f.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("compares Vortex with Parquet from bench's figures, with their date", () => {
    const parquet = byId(list, "vortex-vs-parquet");
    assert.match(defined(parquet.answer[0]), /on 2 Nov 2026/);
    assert.equal(parquet.list?.length, PANELS.length);
    assert.equal(parquet.list?.[0]?.label, "Scan throughput");
    // The GPU row is not bench's, and the note after the list says whose.
    assert.match(defined(parquet.list?.[3]?.text), /not from bench/);
    assert.equal(parquet.after?.[0], GPU_DETAIL);
  });

  it("states the size tradeoff with bench's number", () => {
    const [, tradeoff] = byId(list, "when-to-use-vortex").answer;
    const size = defined(PANELS.find((p) => p.kind === "size"));
    const verdict = resultsRow(size, resultsSystems(PANELS)).verdict;
    assert.match(verdict, /larger$/);
    assert.ok(defined(tradeoff).includes(`Vortex files are ${verdict} than`));
  });

  it("says Vortex is faster only where bench's verdicts say so", () => {
    const [claim] = byId(list, "when-to-use-vortex").answer;
    assert.match(defined(claim), /^For almost every workload, yes\. /);
    assert.match(defined(claim), /faster than Parquet at scans, writes, /);
    // A panel where Vortex is slower turns the claim down and names it.
    const slow = PANELS.map((p) =>
      p.title === "Write throughput"
        ? {
            ...p,
            rows: [
              { system: "Vortex", score: 0.5 },
              { system: "Parquet", score: 1 }
            ]
          }
        : p
    );
    const [mixed] = byId(
      faqs({
        bench: { panels: slow, readAt: READ },
        sparkVersion: null,
        ecosystem: ECOSYSTEM
      }),
      "when-to-use-vortex"
    ).answer;
    assert.match(defined(mixed), /^For most workloads, yes\. /);
    assert.doesNotMatch(defined(mixed), /than Parquet at [^.]*writes/);
    assert.match(defined(mixed), /Parquet is faster at writes\.$/);
  });

  it("leads with no yes when Vortex wins half the speed panels or fewer", () => {
    const panels = PANELS.map((p) =>
      p.kind === "speed" && p.title !== "Scan throughput"
        ? {
            ...p,
            better: "higher" as const,
            rows: [
              { system: "Vortex", score: 0.5 },
              { system: "Parquet", score: 1 }
            ]
          }
        : p
    );
    const [claim] = byId(
      faqs({
        bench: { panels, readAt: READ },
        sparkVersion: null,
        ecosystem: ECOSYSTEM
      }),
      "when-to-use-vortex"
    ).answer;
    assert.match(defined(claim), /^It depends on the workload\. /);
    assert.match(defined(claim), /faster than Parquet at scans\./);
  });

  it("leaves file size open when bench has no size verdict", () => {
    const panels = PANELS.map((p) =>
      p.kind === "size"
        ? { ...p, rows: p.rows.filter((r) => r.system !== "Vortex") }
        : p
    );
    const [, tradeoff, where] = byId(
      faqs({
        bench: { panels, readAt: READ },
        sparkVersion: null,
        ecosystem: ECOSYSTEM
      }),
      "when-to-use-vortex"
    ).answer;
    assert.doesNotMatch(defined(tradeoff), /one advantage/);
    assert.match(defined(tradeoff), /For file size, see bench/);
    assert.match(defined(where), /storage cost or tool support/);
  });

  it("points to bench, with no figures, when bench could not be read", () => {
    const parquet = byId(
      faqs({ bench: null, sparkVersion: null, ecosystem: ECOSYSTEM }),
      "vortex-vs-parquet"
    );
    assert.equal(parquet.list, undefined);
    assert.match(defined(parquet.answer[0]), /bench\.vortex\.dev measures/);
    const [claim] = byId(
      faqs({ bench: null, sparkVersion: null, ecosystem: ECOSYSTEM }),
      "when-to-use-vortex"
    ).answer;
    assert.doesNotMatch(defined(claim), /yes|faster than Parquet at/);
  });

  it("lists the adopters, and the proposed support apart", () => {
    const uses = byId(list, "who-uses-vortex");
    assert.deepEqual(
      uses.list?.map((i) => i.label),
      ["Acme", "Apache Thing", "Initech"]
    );
    assert.deepEqual(uses.after, [
      "Apache Later has a proposal to add Vortex support."
    ]);
  });

  it("gives the install commands as code, Spark's with its version", () => {
    const install = defined(byId(list, "install").list);
    assert.deepEqual(install[0], {
      label: "Rust",
      text: "cargo add vortex",
      code: true
    });
    assert.ok(
      install.some((i) => i.text?.includes("vortex-spark_2.13:0.40.0"))
    );
  });
});

describe("faqJsonLd", () => {
  it("has one Question per question, with the list in its answer", () => {
    const list = faqs({
      bench: { panels: PANELS, readAt: READ },
      sparkVersion: null,
      ecosystem: ECOSYSTEM
    });
    const ld = faqJsonLd(list);
    assert.equal(ld["@type"], "FAQPage");
    assert.equal(ld.mainEntity.length, list.length);
    const parquet = defined(
      ld.mainEntity.find(
        (q) => q.name === "How does Vortex compare to Apache Parquet?"
      )
    );
    assert.match(parquet.acceptedAnswer.text, /\nScan throughput: .+ faster/);
    assert.equal(
      answerText(byId(list, "stability")),
      defined(byId(list, "stability").answer[0])
    );
  });
});

describe("FAQ in llms.txt and llms-full.txt", () => {
  const list = faqs({ bench: null, sparkVersion: null, ecosystem: ECOSYSTEM });

  it("gives each question as a heading, with commands as code", () => {
    const md = faqMarkdown(list).join("\n");
    assert.match(md, /^### What is Vortex\?\n\nVortex is/);
    assert.ok(md.includes("- Rust: `cargo add vortex`"));
  });

  it("links /faq from llms.txt, and gives it in full in llms-full.txt", () => {
    const args = { bench: null, sparkVersion: null, posts: [] };
    assert.ok(
      siteLlmsText(args).includes(
        "- [Questions and answers](https://vortex.dev/faq)"
      )
    );
    const full = siteLlmsFullText({ ...args, faq: list });
    assert.ok(
      full.includes("\n## Questions and answers\n\n### What is Vortex?\n")
    );
    assert.ok(
      full.indexOf("## Questions and answers") <
        full.indexOf("## Posts in full")
    );
  });
});
