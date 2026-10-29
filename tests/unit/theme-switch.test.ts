import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chooseTheme,
  isThemeable,
  readChoice,
  saveChoice,
  THEME_CHOICES
} from "@/lib/theme";

// A fake localStorage that can refuse every call, as a blocked one does.
function fakeStorage(initial: string | null, blocked = false) {
  const items = new Map<string, string>();
  if (initial !== null) items.set("vx-theme", initial);
  return {
    items,
    getItem(key: string) {
      if (blocked) throw new Error("storage blocked");
      return items.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      if (blocked) throw new Error("storage blocked");
      items.set(key, value);
    }
  };
}

describe("THEME_CHOICES", () => {
  it("offers Light, Dark and System, in the ThemeSwitch card's order", () => {
    assert.deepEqual(THEME_CHOICES, ["light", "dark", "system"]);
  });
});

describe("readChoice", () => {
  it("returns the stored choice", () => {
    for (const c of THEME_CHOICES) assert.equal(readChoice(fakeStorage(c)), c);
  });

  it("is Dark when the choice is unset, unknown or blocked", () => {
    assert.equal(readChoice(fakeStorage(null)), "dark");
    assert.equal(readChoice(fakeStorage("sepia")), "dark");
    assert.equal(readChoice(fakeStorage("light", true)), "dark");
    assert.equal(readChoice(null), "dark");
  });
});

describe("saveChoice", () => {
  it("stores the choice under vx-theme", () => {
    const s = fakeStorage(null);
    saveChoice(s, "light");
    assert.equal(s.items.get("vx-theme"), "light");
  });

  it("does nothing when storage is blocked", () => {
    assert.doesNotThrow(() => saveChoice(fakeStorage(null, true), "light"));
    assert.doesNotThrow(() => saveChoice(null, "light"));
  });
});

describe("isThemeable", () => {
  it("is true for the blog index and its posts only", () => {
    assert.equal(isThemeable("/blog"), true);
    assert.equal(isThemeable("/blog/btrblocks-compressor"), true);
    assert.equal(isThemeable("/"), false);
    assert.equal(isThemeable("/blogroll"), false);
    assert.equal(isThemeable(null), false);
  });
});

describe("chooseTheme", () => {
  function fakeWindow(stored: string | null, prefersDark: boolean) {
    const localStorage = fakeStorage(stored);
    const root = { dataset: {} as Record<string, string> };
    return {
      localStorage,
      root,
      win: {
        localStorage,
        matchMedia: () => ({ matches: prefersDark }),
        document: { documentElement: root }
      }
    };
  }

  it("stores the choice and sets data-theme from it on a blog page", () => {
    const w = fakeWindow(null, true);
    chooseTheme("/blog", "light", w.win);
    assert.equal(w.localStorage.items.get("vx-theme"), "light");
    assert.equal(w.root.dataset.theme, "light");
    assert.equal(w.root.dataset.themeChoice, "light");
    chooseTheme("/blog", "system", w.win);
    assert.equal(w.root.dataset.theme, "dark");
    chooseTheme("/blog/welcome", "dark", w.win);
    assert.equal(w.root.dataset.theme, "dark");
  });

  it("follows the OS for System", () => {
    const w = fakeWindow(null, false);
    chooseTheme("/blog", "system", w.win);
    assert.equal(w.root.dataset.theme, "light");
  });

  it("keeps a Dark-only page dark", () => {
    const w = fakeWindow(null, false);
    chooseTheme("/", "light", w.win);
    assert.equal(w.root.dataset.theme, "dark");
  });
});
