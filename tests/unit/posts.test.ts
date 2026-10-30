import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { externalPosts } from "@/content/links";
import {
  adjacentPosts,
  bylineParts,
  byYear,
  editUrl,
  formatPostDate,
  indexEntries
} from "@/lib/posts";

describe("formatPostDate", () => {
  it("writes the BlogIndex card's date, in UTC", () => {
    assert.equal(formatPostDate("2026-02-26T00:00:00.000Z"), "26 Feb 2026");
    assert.equal(formatPostDate("2025-09-08T00:00:00.000Z"), "8 Sep 2025");
    assert.equal(formatPostDate("2025-12-31T23:30:00.000Z"), "31 Dec 2025");
  });
});

describe("bylineParts", () => {
  it("gives the date, the authors and the reading time", () => {
    assert.deepEqual(
      bylineParts({
        date: "2026-02-26T00:00:00.000Z",
        authors: ["Nicholas Gates"],
        metadata: { readingTime: 9 }
      }),
      ["26 Feb 2026", "Nicholas Gates", "9 min read"]
    );
  });

  it("joins several authors with commas, and never reads under a minute", () => {
    assert.deepEqual(
      bylineParts({
        date: "2025-09-08T00:00:00.000Z",
        authors: ["Ada", "Grace"],
        metadata: { readingTime: 0 }
      }),
      ["8 Sep 2025", "Ada, Grace", "1 min read"]
    );
  });
});

describe("adjacentPosts", () => {
  const p = (slugAsParams: string, date: string) => ({ slugAsParams, date });
  // Newest first, as getAllPosts returns them.
  const posts = [
    p("d", "2026-04-01T00:00:00.000Z"),
    p("c", "2026-03-01T00:00:00.000Z"),
    p("b", "2026-02-01T00:00:00.000Z"),
    p("a", "2026-01-01T00:00:00.000Z")
  ];
  const slugs = (a: {
    older: { slugAsParams: string } | null;
    newer: { slugAsParams: string } | null;
  }) => [a.older?.slugAsParams ?? null, a.newer?.slugAsParams ?? null];

  it("takes the nearest older and newer posts by date", () => {
    assert.deepEqual(slugs(adjacentPosts(posts, "c")), ["b", "d"]);
    assert.deepEqual(slugs(adjacentPosts(posts, "b")), ["a", "c"]);
  });

  it("has no neighbour past either end, and none for an unknown slug", () => {
    assert.deepEqual(slugs(adjacentPosts(posts, "d")), ["c", null]);
    assert.deepEqual(slugs(adjacentPosts(posts, "a")), [null, "b"]);
    assert.deepEqual(slugs(adjacentPosts(posts, "x")), [null, null]);
  });

  it("treats two posts of one day as neighbours, in the order given", () => {
    const sameDay = [
      p("b", "2025-09-08T00:00:00.000Z"),
      p("a", "2025-09-08T00:00:00.000Z")
    ];
    assert.deepEqual(slugs(adjacentPosts(sameDay, "b")), ["a", null]);
    assert.deepEqual(slugs(adjacentPosts(sameDay, "a")), [null, "b"]);
  });

  it("orders by date even when the list is not sorted", () => {
    const shuffled = [2, 0, 3, 1].flatMap((i) => posts[i] ?? []);
    assert.deepEqual(slugs(adjacentPosts(shuffled, "b")), ["a", "c"]);
  });
});

describe("editUrl", () => {
  it("links to the post's MDX file on main", () => {
    assert.equal(
      editUrl("blog/october-2025"),
      "https://github.com/vortex-data/vortex.dev/blob/main/src/content/blog/october-2025.mdx"
    );
  });
});

describe("indexEntries", () => {
  const post = (slugAsParams: string, date: string) => ({
    slugAsParams,
    title: slugAsParams,
    date,
    authors: ["Ada"],
    excerpt: `About ${slugAsParams}`
  });
  const link = (url: string, date: string) => ({
    title: url,
    url,
    date,
    source: new URL(url).hostname,
    authors: [],
    summary: "Elsewhere"
  });

  it("mixes own posts and posts elsewhere, newest first", () => {
    const entries = indexEntries(
      [post("b", "2026-02-01"), post("a", "2025-12-01")],
      [link("https://x.example/c", "2026-03-01T00:00:00.000Z")].concat(
        link("https://y.example/d", "2026-01-01T00:00:00.000Z")
      )
    );
    assert.deepEqual(
      entries.map((e) => e.href),
      ["https://x.example/c", "/blog/b", "https://y.example/d", "/blog/a"]
    );
  });

  it("marks an entry elsewhere by its source, and an own post by none", () => {
    const [own, away] = indexEntries(
      [post("b", "2026-02-01")],
      [link("https://x.example/c", "2026-01-01")]
    );
    assert.equal(own?.source, null);
    assert.equal(own?.summary, "About b");
    assert.equal(away?.source, "x.example");
    assert.equal(away?.summary, "Elsewhere");
  });
});

describe("externalPosts", () => {
  it("lists each post once, on its owner's https page, with every field", () => {
    const urls = externalPosts.map((l) => l.url);
    assert.equal(new Set(urls).size, urls.length);
    for (const l of externalPosts) {
      const url = new URL(l.url);
      assert.equal(url.protocol, "https:", l.url);
      assert.equal(url.hostname.replace(/^www\./, ""), l.source, l.url);
      assert.ok(!Number.isNaN(Date.parse(l.date)), `${l.url} has a date`);
      assert.ok(l.title.length > 0 && l.summary.length > 0, l.url);
    }
  });

  it("is newest first, and keeps the btrblocks post native", () => {
    const dates = externalPosts.map((l) => Date.parse(l.date));
    assert.deepEqual(
      [...dates].sort((a, b) => b - a),
      dates
    );
    assert.ok(
      !externalPosts.some((l) => l.url.includes("btrblocks")),
      "the btrblocks post is on vortex.dev"
    );
  });
});

// Note 81: the index groups its rows by year, newest year first, and keeps
// their order inside each year.
describe("byYear", () => {
  const entry = (key: string, date: string) => ({
    key,
    href: `/blog/${key}`,
    title: key,
    date,
    authors: [],
    summary: null,
    source: null
  });

  it("splits the newest-first rows into years, in order, by the UTC year of each date", () => {
    const groups = byYear([
      entry("a", "2026-10-21T09:00:00.000Z"),
      entry("b", "2026-01-01"),
      entry("c", "2025-12-31T23:30:00.000Z"),
      entry("d", "2024-06-01")
    ]);
    assert.deepEqual(
      groups.map((g) => [g.year, g.entries.map((e) => e.key)]),
      [
        ["2026", ["a", "b"]],
        ["2025", ["c"]],
        ["2024", ["d"]]
      ]
    );
  });

  it("covers every entry of the real index once", () => {
    const entries = indexEntries([], externalPosts);
    const groups = byYear(entries);
    assert.equal(
      groups.reduce((n, g) => n + g.entries.length, 0),
      entries.length
    );
    const years = groups.map((g) => g.year);
    assert.deepEqual([...years].sort().reverse(), years);
  });
});
