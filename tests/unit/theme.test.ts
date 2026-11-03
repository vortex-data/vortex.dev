import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import { probeWebgl, THEME_BOOTSTRAP, THEMEABLE, themeFor } from "@/lib/theme";

// Runs the inline first-paint script against a fake page and returns what it set on <html>.
function boot(
  pathname: string,
  stored: string | null,
  prefersDark: boolean,
  blocked = false,
  webgl = true
) {
  const root = {
    className: "no-js __variable_a __variable_b",
    dataset: {} as Record<string, string>
  };
  runInNewContext(THEME_BOOTSTRAP, {
    document: {
      documentElement: root,
      createElement: () => ({
        getContext: () =>
          webgl ? { getExtension: () => ({ loseContext() {} }) } : null
      })
    },
    location: { pathname },
    localStorage: {
      getItem: (key: string) => {
        if (blocked) throw new Error("storage blocked");
        return key === "vx-theme" ? stored : null;
      }
    },
    matchMedia: () => ({ matches: prefersDark })
  });
  return Object.assign(root.dataset, { className: root.className });
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
        themeFor(stored ?? "dark", prefersDark, {
          path,
          themeable: THEMEABLE
        }),
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
        boot(path, stored, prefersDark).theme,
        want,
        `${path} ${stored} ${prefersDark}`
      );
    }
  });

  it("falls back to Dark when storage is blocked", () => {
    assert.equal(boot("/blog", "light", false, true).theme, "dark");
  });

  it("records the choice, which the switch shows pressed before hydration", () => {
    assert.equal(boot("/blog", "system", true).themeChoice, "system");
    assert.equal(boot("/blog", null, true).themeChoice, "dark");
  });

  it("first swaps the root's no-js class for js, keeping its other classes", () => {
    assert.equal(
      boot("/blog", null, false).className,
      "js __variable_a __variable_b"
    );
    assert.ok(
      THEME_BOOTSTRAP.startsWith("document.documentElement.className=")
    );
  });

  it("marks the homepage no-webgl before first paint when the browser has no WebGL", () => {
    assert.match(boot("/", null, false, false, false).className, / no-webgl$/);
    assert.doesNotMatch(boot("/", null, false).className, /no-webgl/);
    // Only the homepage lays itself out by it, so no other page probes.
    assert.doesNotMatch(
      boot("/blog", null, false, false, false).className,
      /no-webgl/
    );
  });

  it("marks the homepage webgl when the browser has WebGL, so a later probe skips", () => {
    assert.match(boot("/", null, false).className, / webgl$/);
  });

  it("probes once when a link renders the homepage in place", () => {
    const fake = (webgl: boolean, classes: string[] = []) => {
      const list = new Set(classes);
      let made = 0;
      const doc = {
        documentElement: {
          classList: {
            contains: (c: string) => list.has(c),
            add: (c: string) => list.add(c)
          }
        },
        createElement: () => {
          made++;
          return {
            getContext: () =>
              webgl ? { getExtension: () => ({ loseContext() {} }) } : null
          };
        }
      };
      probeWebgl(doc as unknown as Document);
      return { list, made };
    };
    assert.ok(fake(false).list.has("no-webgl"));
    assert.ok(fake(true).list.has("webgl"));
    assert.equal(fake(false, ["webgl"]).made, 0);
    assert.equal(fake(true, ["no-webgl"]).list.has("webgl"), false);
  });

  it("is a constant that builds no code from values", () => {
    assert.ok(!THEME_BOOTSTRAP.includes("${"));
  });
});
