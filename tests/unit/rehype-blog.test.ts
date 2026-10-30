import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type HastElement,
  type HastNode,
  type HastRoot,
  rehypeAsides,
  rehypeHeadingIds,
  rehypeHeadingLevels,
  rehypeRefs,
  rehypeTables,
  slugify
} from "@/lib/rehype-blog";

const text = (value: string): HastNode => ({ type: "text", value });
const el = (
  tagName: string,
  children: HastNode[] = [],
  properties: Record<string, unknown> = {}
): HastElement => ({ type: "element", tagName, properties, children });
const root = (...children: HastNode[]): HastRoot => ({
  type: "root",
  children
});
const run = (plugin: () => (tree: HastRoot) => void, tree: HastRoot) => {
  plugin()(tree);
  return tree;
};
const tags = (tree: HastRoot) =>
  tree.children.flatMap((n) => (n.type === "element" ? [n.tagName] : []));

describe("rehypeHeadingLevels", () => {
  it("moves a post that starts at # down to h2, so the page keeps one h1", () => {
    const tree = run(
      rehypeHeadingLevels,
      root(el("h1"), el("p"), el("h2"), el("h1"))
    );
    assert.deepEqual(tags(tree), ["h2", "p", "h3", "h2"]);
  });

  it("leaves a post that starts at ## as it is", () => {
    const tree = run(rehypeHeadingLevels, root(el("h2"), el("h3")));
    assert.deepEqual(tags(tree), ["h2", "h3"]);
  });

  it("moves a post that starts deeper up to h2, and never past h6", () => {
    assert.deepEqual(tags(run(rehypeHeadingLevels, root(el("h3"), el("h4")))), [
      "h2",
      "h3"
    ]);
    assert.deepEqual(tags(run(rehypeHeadingLevels, root(el("h1"), el("h6")))), [
      "h2",
      "h6"
    ]);
  });

  it("finds headings inside other elements", () => {
    const tree = run(rehypeHeadingLevels, root(el("div", [el("h1")])));
    const div = tree.children[0] as HastElement;
    assert.equal((div.children[0] as HastElement).tagName, "h2");
  });
});

describe("rehypeAsides", () => {
  it("marks a blockquote that opens with an emoji as an aside, and drops the emoji", () => {
    const tree = run(
      rehypeAsides,
      root(
        el("blockquote", [
          text("\n"),
          el("p", [text("💡 The sampling RNG is seeded with a fixed value.")]),
          text("\n")
        ])
      )
    );
    const quote = tree.children[0] as HastElement;
    assert.equal(quote.properties.dataAside, "info");
    assert.equal(quote.properties.dataTitle, undefined);
    const p = quote.children[1] as HastElement;
    assert.deepEqual(p.properties.className, ["vx-callout-body"]);
    assert.deepEqual(p.children[0], {
      type: "text",
      value: "The sampling RNG is seeded with a fixed value."
    });
  });

  it("drops an emoji on a line of its own", () => {
    const tree = run(
      rehypeAsides,
      root(el("blockquote", [el("p", [text("🎓\nMaximilian Kuschewski")])]))
    );
    const p = (tree.children[0] as HastElement).children[0] as HastElement;
    assert.deepEqual(p.children[0], {
      type: "text",
      value: "Maximilian Kuschewski"
    });
  });

  it("makes a GitHub alert an aside with its kind and title, and drops a marker line", () => {
    const tree = run(
      rehypeAsides,
      root(
        el("blockquote", [
          el("p", [text("[!WARNING]")]),
          el("p", [text("Back up the file first.")])
        ])
      )
    );
    const quote = tree.children[0] as HastElement;
    assert.equal(quote.properties.dataAside, "warning");
    assert.equal(quote.properties.dataTitle, "Warning");
    assert.equal(quote.children.length, 1);
    const p = quote.children[0] as HastElement;
    assert.deepEqual(p.properties.className, ["vx-callout-body"]);
  });

  it("keeps the alert's text when it shares the marker's paragraph", () => {
    const tree = run(
      rehypeAsides,
      root(el("blockquote", [el("p", [text("[!NOTE]\nLoad it first.")])]))
    );
    const quote = tree.children[0] as HastElement;
    assert.equal(quote.properties.dataTitle, "Note");
    const p = quote.children[0] as HastElement;
    assert.deepEqual(p.children[0], { type: "text", value: "Load it first." });
  });

  it("keeps a blockquote that opens with words as a quote", () => {
    const quote = el("blockquote", [el("p", [text("Editor's note: ...")])]);
    run(rehypeAsides, root(quote));
    assert.equal(quote.properties.dataAside, undefined);
  });
});

describe("rehypeTables", () => {
  const row = (cell: string, ...cells: HastNode[][]) =>
    el("tr", [el("td", [text(cell)]), ...cells.map((c) => el("td", c))]);
  const table = () =>
    el("table", [
      el("thead", [
        el("tr", [el("th", [text("Table")]), el("th", [text("Parquet")])])
      ]),
      el("tbody", [
        row("lineitem", [text("3,103 MB")]),
        row("Total", [el("strong", [text("4,465 MB")]), text(" (0.62x)")])
      ])
    ]);

  it("wraps each table in vx-table-wrap, so a wide one scrolls on its own", () => {
    const tree = run(rehypeTables, root(table()));
    const wrap = tree.children[0] as HastElement;
    assert.equal(wrap.tagName, "div");
    assert.deepEqual(wrap.properties.className, ["vx-table-wrap"]);
    assert.equal((wrap.children[0] as HastElement).tagName, "table");
  });

  it("right-aligns a column whose every cell is a number, and marks a Total row", () => {
    const tree = run(rehypeTables, root(table()));
    const t = (tree.children[0] as HastElement).children[0] as HastElement;
    const [thead, tbody] = t.children as [HastElement, HastElement];
    const headRow = thead.children[0] as HastElement;
    const [first, total] = tbody.children as [HastElement, HastElement];
    const cls = (n: HastNode | undefined) =>
      (n as HastElement).properties.className;
    assert.equal(cls(headRow.children[0]), undefined);
    assert.deepEqual(cls(headRow.children[1]), ["is-num"]);
    assert.deepEqual(cls(first.children[1]), ["is-num"]);
    assert.equal(cls(first.children[0]), undefined);
    assert.deepEqual(total.properties.className, ["is-total"]);
  });

  it("leaves a column of words left-aligned", () => {
    const words = el("table", [
      el("tbody", [row("Constant", [text("Exactly 1 distinct value")])])
    ]);
    const tree = run(rehypeTables, root(words));
    const t = (tree.children[0] as HastElement).children[0] as HastElement;
    const r = (t.children[0] as HastElement).children[0] as HastElement;
    assert.equal(
      (r.children[1] as HastElement).properties.className,
      undefined
    );
  });
});

describe("rehypeRefs", () => {
  const link = (label: string, href = "https://github.com/x/y/pull/1") =>
    el("a", [text(label)], { href });

  it("marks a link whose text is a PR or issue number as a vx-ref", () => {
    const a = link("#5007");
    run(rehypeRefs, root(el("p", [text("Lazy children. "), a])));
    assert.deepEqual(a.properties.className, ["vx-ref"]);
  });

  it("leaves other links, and a number that is not the whole text, alone", () => {
    const words = link("dft");
    const mixed = link("PR #5007");
    run(rehypeRefs, root(el("p", [words, mixed])));
    assert.equal(words.properties.className, undefined);
    assert.equal(mixed.properties.className, undefined);
  });
});

describe("slugify", () => {
  it("turns a heading's text into a fragment", () => {
    assert.equal(slugify("How Parquet does it"), "how-parquet-does-it");
    assert.equal(slugify("ALP & ALP-RD: floats!"), "alp-alp-rd-floats");
    assert.equal(slugify("Marqués"), "marques");
    assert.equal(slugify("September Bulletin #2"), "september-bulletin-2");
    assert.equal(slugify("  "), "section");
  });
});

describe("rehypeHeadingIds", () => {
  it("gives each heading an id and links it to itself, with a # in the margin", () => {
    const h = el("h2", [text("How Parquet does it")]);
    run(rehypeHeadingIds, root(h, el("p", [text("x")])));
    assert.equal(h.properties.id, "how-parquet-does-it");
    const [link] = h.children as HastElement[];
    assert.equal(link?.tagName, "a");
    assert.equal(link?.properties.href, "#how-parquet-does-it");
    assert.deepEqual(link?.properties.className, ["vx-heading-link"]);
    const [mark, label] = link?.children ?? [];
    assert.deepEqual((mark as HastElement).properties, {
      className: ["vx-anchor"],
      ariaHidden: "true"
    });
    assert.deepEqual(label, text("How Parquet does it"));
  });

  it("keeps ids unique within a post", () => {
    const a = el("h3", [text("Integers")]);
    const b = el("h3", [text("Integers")]);
    run(rehypeHeadingIds, root(a, b));
    assert.equal(a.properties.id, "integers");
    assert.equal(b.properties.id, "integers-2");
  });

  it("gives a heading that holds a link a separate # link, since links cannot nest", () => {
    const inner = el("a", [text("DuckDB")], { href: "https://duckdb.org" });
    const h = el("h3", [text("About "), inner]);
    run(rehypeHeadingIds, root(h));
    const [mark, ...rest] = h.children as HastElement[];
    assert.equal(mark?.tagName, "a");
    assert.equal(mark?.properties.href, "#about-duckdb");
    assert.equal(mark?.properties.ariaLabel, "Link to this section");
    assert.deepEqual(mark?.properties.className, ["vx-anchor"]);
    assert.equal(rest[1], inner);
  });
});
