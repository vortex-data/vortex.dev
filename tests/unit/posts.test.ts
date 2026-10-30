import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bylineParts, formatPostDate, kindLabel, morePosts } from "@/lib/posts";

const post = (slugAsParams: string, date: string) => ({ slugAsParams, date });

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

describe("morePosts", () => {
  // getAllPosts returns the posts newest first.
  const posts = [
    post("e", "2026-02-26T00:00:00.000Z"),
    post("d", "2026-01-30T00:00:00.000Z"),
    post("c", "2025-12-08T00:00:00.000Z"),
    post("b", "2025-11-06T00:00:00.000Z"),
    post("a", "2025-10-13T00:00:00.000Z")
  ];
  const slugs = (ps: { slugAsParams: string }[]) =>
    ps.map((p) => p.slugAsParams);

  it("lists the other posts, newest first, at most three", () => {
    assert.deepEqual(slugs(morePosts(posts, "e")), ["d", "c", "b"]);
    assert.deepEqual(slugs(morePosts(posts, "c")), ["e", "d", "b"]);
  });

  it("returns fewer when there are fewer other posts", () => {
    assert.deepEqual(slugs(morePosts(posts.slice(0, 2), "e")), ["d"]);
    assert.deepEqual(slugs(morePosts(posts.slice(0, 1), "e")), []);
  });

  it("sorts by date itself, so the order of its input does not matter", () => {
    assert.deepEqual(slugs(morePosts([...posts].reverse(), "a")), [
      "e",
      "d",
      "c"
    ]);
  });
});
