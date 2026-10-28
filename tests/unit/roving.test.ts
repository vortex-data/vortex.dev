import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextIndex } from "@/lib/roving";

describe("nextIndex", () => {
  it("moves one item along the group's axis and stops at the ends", () => {
    assert.equal(nextIndex("ArrowRight", 0, 5, "horizontal"), 1);
    assert.equal(nextIndex("ArrowLeft", 3, 5, "horizontal"), 2);
    assert.equal(nextIndex("ArrowRight", 4, 5, "horizontal"), 4);
    assert.equal(nextIndex("ArrowLeft", 0, 5, "horizontal"), 0);
    assert.equal(nextIndex("ArrowDown", 1, 5, "vertical"), 2);
    assert.equal(nextIndex("ArrowUp", 1, 5, "vertical"), 0);
  });

  it("jumps to the first item on Home and the last on End", () => {
    for (const orientation of ["horizontal", "vertical"] as const) {
      assert.equal(nextIndex("Home", 3, 5, orientation), 0);
      assert.equal(nextIndex("End", 1, 5, orientation), 4);
    }
  });

  it("gives null for a key that does nothing, so the page keeps its default", () => {
    assert.equal(nextIndex("ArrowDown", 1, 5, "horizontal"), null);
    assert.equal(nextIndex("ArrowRight", 1, 5, "vertical"), null);
    assert.equal(nextIndex("Enter", 1, 5, "horizontal"), null);
    assert.equal(nextIndex("Tab", 1, 5, "horizontal"), null);
  });
});
