import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("the site's copy of the design system styles", () => {
  const tokens = read("src/styles/vortex-tokens.css");

  it("names a font family only in the three --font-* tokens", () => {
    // A literal name would skip next/font's metrics-matched fallback face and shift layout on swap.
    assert.doesNotMatch(
      tokens,
      /font-family:\s*("Funnel Display"|Geist|"Geist Mono")/
    );
    for (const role of ["display", "sans", "mono"]) {
      assert.match(
        tokens,
        new RegExp(`--font-${role}: var\\(--vx-face-`),
        role
      );
    }
  });

  it("gets each --vx-face-* variable from next/font in the root layout", () => {
    const layout = read("src/app/layout.tsx");
    for (const face of ["display", "sans", "mono"]) {
      assert.match(layout, new RegExp(`variable: "--vx-face-${face}"`), face);
    }
  });

  it("loads the tokens, then the components, from globals.css", () => {
    const globals = read("src/app/globals.css");
    const t = globals.indexOf('@import "../styles/vortex-tokens.css"');
    const c = globals.indexOf('@import "../styles/vortex.css"');
    assert.ok(t > -1 && c > t, "tokens import precedes components import");
  });
});
