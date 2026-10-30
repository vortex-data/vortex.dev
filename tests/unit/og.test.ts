import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { OG_COVER_COLOURS } from "@/lib/og";

const tokens = readFileSync(
  new URL("../../src/styles/vortex-tokens.css", import.meta.url),
  "utf8"
);
const value = (name: string) =>
  tokens.match(new RegExp(`--${name}: (#[0-9a-f]{6});`))?.[1];

describe("a post's Open Graph image", () => {
  it("paints the Cover in the design system's Dark values", () => {
    assert.equal(OG_COVER_COLOURS.ground, value("ground-dark"));
    assert.equal(OG_COVER_COLOURS.ink, value("white"));
    assert.equal(OG_COVER_COLOURS.muted, value("grey-450"));
    assert.equal(OG_COVER_COLOURS.edge, value("grey-600"));
    assert.equal(OG_COVER_COLOURS.accent, value("blue-bright"));
  });

  it("sets its text in the design system's faces, which ship beside it", () => {
    const og = readFileSync(
      new URL("../../src/lib/og.tsx", import.meta.url),
      "utf8"
    );
    for (const f of ["FunnelDisplay-Medium.ttf", "GeistMono-Regular.ttf"]) {
      assert.ok(og.includes(f), f);
      assert.ok(
        readFileSync(new URL(`../../src/lib/og-assets/${f}`, import.meta.url))
          .length > 10_000,
        f
      );
    }
    assert.match(og, /fontFamily: "Funnel Display"/);
  });
});
