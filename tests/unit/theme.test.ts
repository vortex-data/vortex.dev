import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import {
  DARK_LOCK_SCRIPT,
  probeWebgl,
  SITE_THEMEABLE,
  THEME_BOOTSTRAP,
  themeFor
} from "@/lib/theme";

// Runs the inline first-paint script against a fake page and returns what it set on <html>.
function boot(
  pathname: string,
  stored: string | null,
  prefersDark: boolean,
  blocked = false,
  webgl = true,
  cookie = ""
) {
  const root = {
    className: "no-js __variable_a __variable_b",
    dataset: {} as Record<string, string>
  };
  runInNewContext(THEME_BOOTSTRAP, {
    document: {
      documentElement: root,
      cookie,
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

// The blog follows the reader's choice, and no choice is System (design system DECISIONS 37). The
// homepage and every other path, the 404 among them, stay Dark whatever the choice.
const CASES: [string, string | null, boolean, "light" | "dark"][] = [
  ["/", "light", false, "dark"],
  ["/", "system", false, "dark"],
  ["/", null, true, "dark"],
  ["/", null, false, "dark"],
  ["/blog", "light", true, "light"],
  ["/blog/btrblocks-compressor", "light", true, "light"],
  ["/blog", "dark", false, "dark"],
  ["/blog", "system", true, "dark"],
  ["/blog", null, false, "light"],
  ["/blog", "sepia", false, "light"],
  ["/no-such-page", "light", false, "dark"]
];

describe("themeFor", () => {
  it("follows the reader's choice on the blog, and keeps the other pages Dark", () => {
    for (const [path, stored, prefersDark, want] of CASES) {
      assert.equal(
        // An unknown stored value reads as System, as the bootstrap reads it.
        themeFor(
          ["light", "dark", "system"].includes(stored ?? "")
            ? (stored ?? "")
            : "system",
          prefersDark,
          { path, themeable: SITE_THEMEABLE }
        ),
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

  it("falls back to System when storage is blocked", () => {
    assert.equal(boot("/blog", "light", false, true).theme, "light");
    assert.equal(boot("/blog", "light", true, true).theme, "dark");
  });

  it("reads the choice that the vortex.dev cookie shares across the subdomains first", () => {
    assert.equal(
      boot("/blog", "dark", false, false, true, "vx-theme=light").theme,
      "light"
    );
    assert.equal(
      boot("/blog", "dark", false, true, true, "a=1; vx-theme=light").theme,
      "light"
    );
  });

  it("records the choice, which the switch shows pressed before hydration", () => {
    assert.equal(boot("/blog", "system", true).themeChoice, "system");
    assert.equal(boot("/blog", null, true).themeChoice, "system");
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

describe("DARK_LOCK_SCRIPT", () => {
  it("locks the page Dark before the rest of the page paints", () => {
    const root = {
      dataset: { theme: "light", themeChoice: "light" } as Record<
        string,
        string
      >
    };
    runInNewContext(DARK_LOCK_SCRIPT, { document: { documentElement: root } });
    assert.deepEqual(root.dataset, {
      theme: "dark",
      themeChoice: "light",
      themeLock: "dark"
    });
  });
});
