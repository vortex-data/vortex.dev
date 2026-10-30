/**
 * Rehype plugins that fit a post's Markdown to the design system's Article
 * card. velite.config.ts runs them after rehype-pretty-code. They work on
 * plain HAST objects and add no dependency. Which blockquotes become a
 * Callout is the design system's rule (`callout.js`).
 */

import { calloutOf } from "../vendor/vortex-design/callout.js";

export interface HastText {
  type: "text";
  value: string;
}

export interface HastElement {
  type: "element";
  tagName: string;
  properties: Record<string, unknown>;
  children: HastNode[];
}

/** Nodes the plugins pass over: comments, raw HTML and MDX's own nodes. */
interface HastOther {
  type:
    | "comment"
    | "doctype"
    | "raw"
    | "mdxJsxFlowElement"
    | "mdxJsxTextElement"
    | "mdxFlowExpression"
    | "mdxTextExpression"
    | "mdxjsEsm";
  children?: HastNode[];
}

export type HastNode = HastText | HastElement | HastOther;

export interface HastRoot {
  type: "root";
  children: HastNode[];
}

type Parent = HastRoot | HastElement;

// Calls `fn` on every element, parents before their children.
function visit(
  parent: Parent,
  fn: (el: HastElement, parent: Parent, index: number) => void
): void {
  parent.children.forEach((node, i) => {
    if (node.type !== "element") return;
    fn(node, parent, i);
    visit(node, fn);
  });
}

function elements(parent: Parent, tagName: string): HastElement[] {
  const found: HastElement[] = [];
  visit(parent, (el) => {
    if (el.tagName === tagName) found.push(el);
  });
  return found;
}

function textOf(node: HastNode): string {
  if (node.type === "text") return node.value;
  return (node.children ?? []).map(textOf).join("");
}

function addClass(el: HastElement, name: string): void {
  const old = el.properties.className;
  el.properties.className = [...(Array.isArray(old) ? old : []), name];
}

const HEADING = /^h([1-6])$/;

/**
 * Sets a post's top heading level to h2, under the page's one h1 (the
 * title), and moves its other headings by the same step, as the Article
 * card asks of a renderer. Posts start at `#` or at `##`.
 */
export function rehypeHeadingLevels() {
  return (tree: HastRoot) => {
    const headings: [HastElement, number][] = [];
    visit(tree, (el) => {
      const depth = el.tagName.match(HEADING)?.[1];
      if (depth) headings.push([el, Number(depth)]);
    });
    if (headings.length === 0) return;
    const shift = 2 - Math.min(...headings.map(([, d]) => d));
    for (const [el, d] of headings) el.tagName = `h${Math.min(6, d + shift)}`;
  };
}

/**
 * Marks a blockquote the Callout card's rule picks out as an aside: a GitHub
 * alert ("> [!NOTE]") or one that opens with an emoji ("> 💡 …"). It drops
 * the marker and records the kind (`data-aside`) and any title
 * (`data-title`), which `mdx-components.tsx` draws. Its paragraphs become
 * `vx-callout-body`. A blockquote that opens with words stays a quote.
 */
export function rehypeAsides() {
  return (tree: HastRoot) => {
    for (const quote of elements(tree, "blockquote")) {
      const paras = quote.children.filter(
        (n): n is HastElement => n.type === "element" && n.tagName === "p"
      );
      const [lead] = paras;
      const first = lead?.children[0];
      if (!lead || first?.type !== "text") continue;
      const callout = calloutOf(first.value);
      if (!callout) continue;
      first.value = callout.rest;
      quote.properties.dataAside = callout.kind;
      if (callout.title) quote.properties.dataTitle = callout.title;
      // An alert's marker on a line of its own leaves an empty paragraph.
      let body = paras;
      if (callout.rest.trim() === "" && lead.children.length === 1) {
        quote.children = quote.children.filter((n) => n !== lead);
        body = paras.slice(1);
      }
      for (const p of body) addClass(p, "vx-callout-body");
    }
  };
}

const NUMBER = /^[−-]?\d/;

/**
 * Fits a post's tables to the system's prose table rules: each one sits in
 * a `vx-table-wrap`, which scrolls a wide table on its own; a column whose
 * every body cell starts with a number is `is-num` (right-aligned, mono);
 * and a body row that starts with "Total" is `is-total`.
 */
export function rehypeTables() {
  return (tree: HastRoot) => {
    const wraps: [HastElement, Parent, number][] = [];
    visit(tree, (el, parent, i) => {
      if (el.tagName === "table") wraps.push([el, parent, i]);
    });
    for (const [table, parent, i] of wraps) {
      markNumbers(table);
      parent.children[i] = {
        type: "element",
        tagName: "div",
        properties: { className: ["vx-table-wrap"] },
        children: [table]
      };
    }
  };
}

function cellsOf(row: HastElement): HastElement[] {
  return row.children.filter(
    (n): n is HastElement =>
      n.type === "element" && (n.tagName === "td" || n.tagName === "th")
  );
}

function markNumbers(table: HastElement): void {
  const rows = elements(table, "tr");
  const body = rows.filter((r) => cellsOf(r).every((c) => c.tagName === "td"));
  if (body.length === 0) return;
  const width = Math.max(...rows.map((r) => cellsOf(r).length));
  for (let col = 0; col < width; col++) {
    const numeric = body.every((r) => {
      const cell = cellsOf(r)[col];
      return cell !== undefined && NUMBER.test(textOf(cell).trim());
    });
    if (!numeric) continue;
    for (const r of rows) {
      const cell = cellsOf(r)[col];
      if (cell) addClass(cell, "is-num");
    }
  }
  for (const r of body) {
    const first = cellsOf(r)[0];
    if (first && textOf(first).trim().toLowerCase() === "total")
      addClass(r, "is-total");
  }
}

const REF = /^#\d+$/;

/**
 * Marks a link whose whole text is a PR or issue number ("#5024") as the
 * Article card's `vx-ref`: quiet mono with a chip on hover, so a run of
 * them reads as one reference.
 */
export function rehypeRefs() {
  return (tree: HastRoot) => {
    for (const a of elements(tree, "a"))
      if (REF.test(textOf(a).trim())) addClass(a, "vx-ref");
  };
}

/**
 * A heading's text as a URL fragment: lower case, accents dropped, and
 * every run of other characters one hyphen. Empty text gives "section".
 */
export function slugify(text: string): string {
  const slug = text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
}

function hasLink(node: HastNode): boolean {
  if (node.type === "element" && node.tagName === "a") return true;
  return (node.type === "element" ? node.children : []).some(hasLink);
}

/**
 * Gives each of a post's headings an id from its text, unique in the post,
 * and links the heading to itself, as the Article card asks. The "#" sits
 * in the margin and shows on hover and focus. A heading that holds a link of
 * its own gets the "#" as a separate link, because links cannot nest. Runs
 * after rehypeHeadingLevels.
 */
export function rehypeHeadingIds() {
  return (tree: HastRoot) => {
    const used = new Map<string, number>();
    visit(tree, (el) => {
      if (!/^h[2-6]$/.test(el.tagName)) return;
      const base = slugify(textOf(el));
      const n = (used.get(base) ?? 0) + 1;
      used.set(base, n);
      const id = n === 1 ? base : `${base}-${n}`;
      el.properties.id = id;
      const href = `#${id}`;
      if (el.children.some(hasLink)) {
        el.children.unshift({
          type: "element",
          tagName: "a",
          properties: {
            href,
            className: ["vx-anchor"],
            ariaLabel: "Link to this section"
          },
          children: [{ type: "text", value: "#" }]
        });
        return;
      }
      el.children = [
        {
          type: "element",
          tagName: "a",
          properties: { href, className: ["vx-heading-link"] },
          children: [
            {
              type: "element",
              tagName: "span",
              properties: { className: ["vx-anchor"], ariaHidden: "true" },
              children: [{ type: "text", value: "#" }]
            },
            ...el.children
          ]
        }
      ];
    });
  };
}
