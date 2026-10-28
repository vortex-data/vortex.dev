import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blogCurrent } from "@/lib/nav";

describe("blogCurrent", () => {
  it("marks the blog index as the current page and a post's Blog link as the current section", () => {
    assert.equal(blogCurrent("/blog"), "page");
    assert.equal(blogCurrent("/blog/btrblocks-compressor"), "true");
    assert.equal(blogCurrent("/"), null);
    assert.equal(blogCurrent("/blogroll"), null);
  });
});
