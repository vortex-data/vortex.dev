import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import { THEME_BOOTSTRAP, themeFor } from "@/lib/theme";

// Runs the inline first-paint script against a fake page and returns the theme it set.
function boot(
  pathname: string,
  stored: string | null,
  prefersDark: boolean,
  blocked = false
) {
  const root = { dataset: {} as Record<string, string> };
  runInNewContext(THEME_BOOTSTRAP, {
    document: { documentElement: root },
    location: { pathname },
    localStorage: {
      getItem: (key: string) => {
        if (blocked) throw new Error("storage blocked");
        return key === "vx-theme" ? stored : null;
      }
    },
    matchMedia: () => ({ matches: prefersDark })
  });
  return root.dataset.theme;
}

const CASES: [string, string | null, boolean, "light" | "dark"][] = [
  ["/", "light", false, "dark"],
  ["/", "system", false, "dark"],
  ["/blog", "light", true, "light"],
  ["/blog/btrblocks-compressor", "light", true, "light"],
  ["/blog", "dark", false, "dark"],
  ["/blog", "system", false, "light"],
  ["/blog", "system", true, "dark"],
  ["/blog", null, false, "dark"],
  ["/blog", "sepia", false, "dark"],
  ["/blogroll", "light", false, "dark"],
  ["/no-such-page", "light", false, "dark"]
];

describe("themeFor", () => {
  it("keeps every page Dark except the blog, which follows the reader's choice", () => {
    for (const [path, stored, prefersDark, want] of CASES) {
      assert.equal(
        themeFor(path, stored, prefersDark),
        want,
        `${path} ${stored} ${prefersDark}`
      );
    }
  });
});

describe("THEME_BOOTSTRAP", () => {
  it("sets the same theme as themeFor before first paint", () => {
    for (const [path, stored, prefersDark, want] of CASES) {
      assert.equal(
        boot(path, stored, prefersDark),
        want,
        `${path} ${stored} ${prefersDark}`
      );
    }
  });

  it("falls back to Dark when storage is blocked", () => {
    assert.equal(boot("/blog", "light", false, true), "dark");
  });

  it("is a constant that builds no code from values", () => {
    assert.ok(!THEME_BOOTSTRAP.includes("${"));
  });
});
