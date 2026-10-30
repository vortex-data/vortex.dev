import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { barRows, barsLabel, chainLabel } from "@/lib/figures";

describe("barRows", () => {
  it("measures each bar against the largest value, in the post's order", () => {
    const rows = barRows([
      { name: "Parquet + zstd", value: 4465 },
      { name: "Vortex default", value: 2776, ours: true, extra: "0.62×" }
    ]);
    assert.deepEqual(
      rows.map((r) => [r.name, r.width, r.value, r.ours, r.extra]),
      [
        ["Parquet + zstd", 100, "4,465", false, undefined],
        ["Vortex default", 62.17, "2,776", true, "0.62×"]
      ]
    );
  });
});

describe("barsLabel", () => {
  it("states every figure for a screen reader", () => {
    assert.equal(
      barsLabel("Commits", [
        { name: "Connor Tsui", value: 41 },
        { name: "Joe Isaacs", value: 38 }
      ]),
      "Commits: Connor Tsui 41, Joe Isaacs 38"
    );
  });
});

describe("chainLabel", () => {
  it("reads a chain as steps in order", () => {
    assert.equal(
      chainLabel(["Dictionary", "REE", "BitPacking"]),
      "Dictionary, then REE, then BitPacking"
    );
  });
});
