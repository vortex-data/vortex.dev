import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import {
  BENCH_THEME_BOOTSTRAP,
  probeWebgl,
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

// Every page follows the reader's choice, the homepage too, and no choice is Dark, whatever the OS
// prefers (design system DECISIONS 37 and 43).
const CASES: [string, string | null, boolean, "light" | "dark"][] = [
  ["/", "light", false, "light"],
  ["/", "system", false, "light"],
  ["/", null, true, "dark"],
  ["/", null, false, "dark"],
  ["/blog", "light", true, "light"],
  ["/blog/btrblocks-compressor", "light", true, "light"],
  ["/blog", "dark", false, "dark"],
  ["/blog", "system", true, "dark"],
  ["/blog", "sepia", false, "dark"],
  ["/no-such-page", "light", false, "light"]
];

describe("themeFor", () => {
  it("follows the reader's choice on every page", () => {
    for (const [path, stored, prefersDark, want] of CASES) {
      assert.equal(
        // An unknown stored value reads as Dark, the default, as the bootstrap reads it.
        themeFor(
          ["light", "dark", "system"].includes(stored ?? "")
            ? (stored ?? "")
            : "dark",
          prefersDark,
          { path }
        ),
        want,
        `${path} ${stored} ${prefersDark}`
      );
    }
  });
});

// Runs a first-paint script against a page whose storage holds `items`, and returns the theme and
// what storage holds afterwards.
function bootWith(script: string, items: Record<string, string>) {
  const store = new Map(Object.entries(items));
  const root = { className: "no-js", dataset: {} as Record<string, string> };
  runInNewContext(script, {
    document: {
      documentElement: root,
      cookie: "",
      createElement: () => ({ getContext: () => null })
    },
    location: { pathname: "/bench" },
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key)
    },
    matchMedia: () => ({ matches: true })
  });
  return { theme: root.dataset.theme, store: Object.fromEntries(store) };
}

// bench saved the choice under "bench-theme" before it shared vx-theme with the site, on the same
// origin, so a returning reader keeps a Light or Dark choice they made there.
describe("the old bench key", () => {
  for (const [name, script] of [
    ["bench", BENCH_THEME_BOOTSTRAP],
    ["the site", THEME_BOOTSTRAP]
  ] as const) {
    it(`moves to vx-theme on ${name}'s first paint`, () => {
      assert.deepEqual(bootWith(script, { "bench-theme": "light" }), {
        theme: "light",
        store: { "vx-theme": "light" }
      });
    });

    it(`gives way to a vx-theme choice on ${name}, and is removed`, () => {
      assert.deepEqual(
        bootWith(script, { "bench-theme": "light", "vx-theme": "dark" }),
        { theme: "dark", store: { "vx-theme": "dark" } }
      );
    });
  }

  it("is dropped when it holds no theme", () => {
    assert.deepEqual(
      bootWith(BENCH_THEME_BOOTSTRAP, { "bench-theme": "sepia" }),
      {
        theme: "dark",
        store: {}
      }
    );
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
    assert.equal(boot("/blog", "light", true, true).theme, "dark");
  });

  it("reads the choice that the vortex.dev cookie shares across the subdomains first", () => {
    assert.equal(
      boot("/", "dark", false, false, true, "vx-theme=light").theme,
      "light"
    );
    assert.equal(
      boot("/", "dark", false, true, true, "a=1; vx-theme=light").theme,
      "light"
    );
  });

  it("records the choice, which the switch shows pressed before hydration", () => {
    assert.equal(boot("/blog", "system", true).themeChoice, "system");
    assert.equal(boot("/blog", null, false).themeChoice, "dark");
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
