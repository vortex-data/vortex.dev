import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
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

  // Note 59: the reset is the system's base.css, copied as vortex-base.css,
  // and the site keeps no reset of its own.
  it("takes its reset from the system's base.css, in a layer", () => {
    const globals = read("src/app/globals.css");
    assert.ok(globals.includes('@import "../styles/vortex-base.css"'));
    assert.match(read("src/styles/vortex-base.css"), /@layer vx-base \{/);
    assert.doesNotMatch(
      globals,
      /@layer|list-style: none|margin: 0;\s*padding: 0/
    );
  });
});

// The system's copies are made by its tools, and CI cannot reach the system.
// Each copy carries a hash of itself, so a hand edit fails here.
describe("the design system's copies are unedited", () => {
  const sha256 = (text: string) =>
    createHash("sha256").update(text).digest("hex");

  for (const name of ["vortex-tokens.css", "vortex.css", "vortex-base.css"]) {
    it(`src/styles/${name} matches the hash in its header`, () => {
      const css = read(`src/styles/${name}`);
      const end = css.indexOf("*/\n") + 3;
      const hash = css.slice(0, end).match(/sha256 ([0-9a-f]{64})/)?.[1];
      assert.ok(hash, "the header records a sha256");
      assert.equal(
        sha256(css.slice(end)),
        hash,
        `${name} was edited by hand: change the system and run its tools/site-styles.mjs`
      );
    });
  }

  it("lists every vendored module in SHA256SUMS", () => {
    // The site's own files there: the README, the sums, and the type
    // declarations the site writes for modules the system ships without one.
    const own = new Set([
      "README.md",
      "SHA256SUMS",
      "ascii-core.d.ts",
      "ascii-mark.d.ts",
      "three.d.ts"
    ]);
    const listed = new Set(
      read("src/vendor/vortex-design/SHA256SUMS")
        .trim()
        .split("\n")
        .map((line) => line.split(/\s+/)[1])
    );
    const dir = new URL("../../src/vendor/vortex-design/", import.meta.url);
    for (const file of readdirSync(dir)) {
      if (own.has(file)) continue;
      assert.ok(listed.has(file), `${file} is vendored but not in SHA256SUMS`);
    }
  });

  it("each vendored module matches vendor/vortex-design/SHA256SUMS", () => {
    const sums = read("src/vendor/vortex-design/SHA256SUMS").trim().split("\n");
    assert.ok(sums.length >= 10);
    for (const line of sums) {
      const [hash, file] = line.split(/\s+/);
      assert.equal(
        sha256(read(`src/vendor/vortex-design/${file}`)),
        hash,
        `${file} was edited by hand: change the system and copy it again`
      );
    }
  });
});
