import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adjacentPosts,
  bylineParts,
  editUrl,
  formatPostDate,
  kindLabel,
  splitLead
} from "@/lib/posts";

describe("formatPostDate", () => {
  it("writes the BlogIndex card's date, in UTC", () => {
    assert.equal(formatPostDate("2026-02-26T00:00:00.000Z"), "26 Feb 2026");
    assert.equal(formatPostDate("2025-09-08T00:00:00.000Z"), "8 Sep 2025");
    assert.equal(formatPostDate("2025-12-31T23:30:00.000Z"), "31 Dec 2025");
  });
});

describe("kindLabel", () => {
  it("names a post's kind as the Article card's eyebrow says it", () => {
    assert.equal(kindLabel("deep-dive"), "Deep dive");
    assert.equal(kindLabel("bulletin"), "Bulletin");
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
  const p = (
    slugAsParams: string,
    date: string,
    kind: "deep-dive" | "bulletin"
  ) => ({ slugAsParams, date, kind });
  // Newest first, as getAllPosts returns them.
  const posts = [
    p("bull-4", "2026-04-01T00:00:00.000Z", "bulletin"),
    p("deep-2", "2026-03-01T00:00:00.000Z", "deep-dive"),
    p("bull-3", "2026-02-01T00:00:00.000Z", "bulletin"),
    p("bull-2", "2026-01-01T00:00:00.000Z", "bulletin"),
    p("deep-1", "2025-12-01T00:00:00.000Z", "deep-dive"),
    p("bull-1", "2025-11-01T00:00:00.000Z", "bulletin")
  ];
  const slugs = (a: {
    older: { slugAsParams: string } | null;
    newer: { slugAsParams: string } | null;
  }) => [a.older?.slugAsParams ?? null, a.newer?.slugAsParams ?? null];

  it("takes the nearest older and newer posts of the same kind", () => {
    assert.deepEqual(slugs(adjacentPosts(posts, "deep-2")), [
      "deep-1",
      "bull-4"
    ]);
    assert.deepEqual(slugs(adjacentPosts(posts, "bull-3")), [
      "bull-2",
      "bull-4"
    ]);
    assert.deepEqual(slugs(adjacentPosts(posts, "deep-1")), [
      "bull-1",
      "deep-2"
    ]);
  });

  it("falls back to the nearest post of any kind, and to none at the ends", () => {
    assert.deepEqual(slugs(adjacentPosts(posts, "bull-4")), ["bull-3", null]);
    assert.deepEqual(slugs(adjacentPosts(posts, "bull-1")), [null, "bull-2"]);
  });

  it("treats two posts of one day as neighbours, in the order given", () => {
    const sameDay = [
      p("b", "2025-09-08T00:00:00.000Z", "bulletin"),
      p("a", "2025-09-08T00:00:00.000Z", "bulletin")
    ];
    assert.deepEqual(slugs(adjacentPosts(sameDay, "b")), ["a", null]);
    assert.deepEqual(slugs(adjacentPosts(sameDay, "a")), [null, "b"]);
  });

  it("orders by date even when the list is not sorted", () => {
    const shuffled = [3, 0, 5, 2, 1, 4].flatMap((i) => posts[i] ?? []);
    assert.deepEqual(slugs(adjacentPosts(shuffled, "bull-3")), [
      "bull-2",
      "bull-4"
    ]);
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

describe("splitLead", () => {
  const p = (
    slugAsParams: string,
    date: string,
    kind: "deep-dive" | "bulletin"
  ) => ({
    slugAsParams,
    date,
    kind
  });

  it("leads with the newest deep dive and keeps the rest newest first", () => {
    const posts = [
      p("bull-3", "2026-03-01T00:00:00.000Z", "bulletin"),
      p("deep-2", "2026-02-26T00:00:00.000Z", "deep-dive"),
      p("bull-2", "2026-01-30T00:00:00.000Z", "bulletin"),
      p("deep-1", "2025-12-01T00:00:00.000Z", "deep-dive")
    ];
    const { lead, rest } = splitLead(posts);
    assert.equal(lead?.slugAsParams, "deep-2");
    assert.deepEqual(
      rest.map((x) => x.slugAsParams),
      ["bull-3", "bull-2", "deep-1"]
    );
  });

  it("has no lead when there is no deep dive", () => {
    const posts = [p("b", "2026-01-30T00:00:00.000Z", "bulletin")];
    assert.deepEqual(splitLead(posts), { lead: null, rest: posts });
  });
});
