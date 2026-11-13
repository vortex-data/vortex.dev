import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blogCurrent, navLinks, socialLinks } from "@/lib/nav";

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

  // Slack left the links for an icon beside the GitHub button (socialLinks).
  it("gives the site its own Blog path, and Benchmarks its host", () => {
    const links = byLabel(navLinks("/blog"));
    assert.deepEqual(Object.keys(links), [
      "Docs",
      "Benchmarks",
      "Explorer",
      "Blog"
    ]);
    // Outside production, the deployment's own /bench (bench-link.ts).
    assert.equal(links.Benchmarks?.href, "/bench");
    assert.equal(links.Blog?.href, "/blog");
    assert.equal(links.Blog?.internal, true);
    assert.equal(links.Blog?.current, "page");
  });

  // bench is served from its own host, so a path there would name a bench page.
  it("gives bench absolute links to the site, and marks Benchmarks current", () => {
    for (const home of ["/", "/bench"]) {
      const links = byLabel(navLinks(home, { home }));
      assert.equal(links.Blog?.href, "https://vortex.dev/blog");
      assert.equal(links.Benchmarks?.href, home);
      assert.equal(links.Benchmarks?.current, "page");
      assert.equal(links.Blog?.current, null);
      for (const l of Object.values(links)) assert.equal(l.internal, false);
    }
    // On bench's host a client may see the path before or after the rewrite to /bench.
    for (const [path, home] of [
      ["/bench/chart/tpch-q1", "/bench"],
      ["/chart/tpch-q1", "/"],
      ["/bench/chart/tpch-q1", "/"]
    ] as const)
      assert.equal(
        byLabel(navLinks(path, { home })).Benchmarks?.current,
        "true"
      );
    assert.equal(
      byLabel(navLinks("/bench", { home: "/" })).Benchmarks?.current,
      "page"
    );
  });
});

describe("socialLinks", () => {
  it("gives the site its Slack redirect, and bench the site's", () => {
    assert.deepEqual(socialLinks(), {
      slack: "/slack",
      x: "https://x.com/vortexdotdev"
    });
    for (const home of ["/", "/bench"])
      assert.deepEqual(socialLinks({ home }), {
        slack: "https://vortex.dev/slack",
        x: "https://x.com/vortexdotdev"
      });
  });
});
