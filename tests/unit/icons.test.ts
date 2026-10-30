import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

// The design system draws every icon as an SVG; a text glyph never stands in for one.
describe("site components", () => {
  it("draw icons as SVGs, never text glyphs", () => {
    const src = new URL("../../src/", import.meta.url);
    const files = readdirSync(src, {
      recursive: true,
      encoding: "utf8"
    }).filter((f) => /\.tsx?$/.test(f));
    assert.ok(files.length > 10);
    for (const f of files) {
      const code = readFileSync(new URL(f, src), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      assert.doesNotMatch(code, /[ⓘℹ★☆✓✔]/, f);
    }
  });
});
