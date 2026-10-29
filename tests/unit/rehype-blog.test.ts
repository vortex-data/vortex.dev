import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type HastElement,
  type HastNode,
  type HastRoot,
  rehypeAsides,
  rehypeHeadingLevels,
  rehypeTables
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
