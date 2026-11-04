import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blogCurrent, navLinks } from "@/lib/nav";

describe("blogCurrent", () => {
  it("marks the blog index as the current page and a post's Blog link as the current section", () => {
    assert.equal(blogCurrent("/blog"), "page");
    assert.equal(blogCurrent("/blog/btrblocks-compressor"), "true");
    assert.equal(blogCurrent("/"), null);
    assert.equal(blogCurrent("/blogroll"), null);
  });
});

describe("navLinks", () => {
  const byLabel = (links: ReturnType<typeof navLinks>) =>
    Object.fromEntries(links.map((l) => [l.label, l]));

  it("gives the site its own Blog and Slack paths, and Bench its host", () => {
    const links = byLabel(navLinks("/blog"));
    assert.deepEqual(Object.keys(links), [
      "Docs",
      "Bench",
      "Explorer",
      "Blog",
      "Slack"
    ]);
    assert.equal(links.Bench?.href, "https://bench.vortex.dev");
    assert.equal(links.Blog?.href, "/blog");
    assert.equal(links.Blog?.internal, true);
    assert.equal(links.Blog?.current, "page");
    assert.equal(links.Slack?.href, "/slack");
  });

  // bench is served from its own host, so a path there would name a bench page.
  it("gives bench absolute links to the site, and marks Bench current", () => {
    for (const home of ["/", "/bench"]) {
      const links = byLabel(navLinks(home, { home }));
      assert.equal(links.Blog?.href, "https://vortex.dev/blog");
      assert.equal(links.Slack?.href, "https://vortex.dev/slack");
      assert.equal(links.Bench?.href, home);
      assert.equal(links.Bench?.current, "page");
      assert.equal(links.Blog?.current, null);
      for (const l of Object.values(links)) assert.equal(l.internal, false);
    }
    // On bench's host a client may see the path before or after the rewrite to /bench.
    for (const [path, home] of [
      ["/bench/chart/tpch-q1", "/bench"],
      ["/chart/tpch-q1", "/"],
      ["/bench/chart/tpch-q1", "/"]
    ] as const)
      assert.equal(byLabel(navLinks(path, { home })).Bench?.current, "true");
    assert.equal(
      byLabel(navLinks("/bench", { home: "/" })).Bench?.current,
      "page"
    );
  });
});
