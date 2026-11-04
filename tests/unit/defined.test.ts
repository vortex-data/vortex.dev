import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defined } from "@/lib/defined";

describe("defined", () => {
  it("returns a value that is there, falsy values included", () => {
    assert.equal(defined(0), 0);
    assert.equal(defined(""), "");
    assert.equal(defined(false), false);
    const list = [1, 2];
    assert.equal(defined(list[1]), 2);
  });

  it("throws on null and undefined, and names what is missing", () => {
    assert.throws(
      () => defined(null),
      /expected value to be defined, got null/
    );
    assert.throws(
      () => defined([][0], "the first row"),
      /expected the first row to be defined, got undefined/
    );
  });
});
