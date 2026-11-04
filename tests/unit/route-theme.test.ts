import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyRouteTheme, chooseTheme } from "@/lib/theme";

// A fake window: stored choice, an OS preference that can change, and <html>'s dataset.
function fakeWindow(stored: string | null, prefersDark: boolean) {
  const listeners = new Set<() => void>();
  const media = {
    matches: prefersDark,
    addEventListener: (_: string, f: () => void) => listeners.add(f),
    removeEventListener: (_: string, f: () => void) => listeners.delete(f)
  };
  const root = { dataset: {} as Record<string, string> };
  return {
    win: {
      localStorage: { getItem: () => stored },
      matchMedia: () => media,
      document: { documentElement: root }
    },
    root,
    listeners,
    setOs(dark: boolean) {
      media.matches = dark;
      for (const f of listeners) f();
    }
  };
}

describe("applyRouteTheme", () => {
  it("follows the OS while a blog page set to system stays open", () => {
    const w = fakeWindow("system", true);
    const stop = applyRouteTheme("/blog/welcome", w.win);
    assert.equal(w.root.dataset.theme, "dark");
    w.setOs(false);
    assert.equal(w.root.dataset.theme, "light");
    stop();
    assert.equal(w.listeners.size, 0);
  });

  it("keeps a page that the root locks Dark (the homepage, the 404) Dark, whatever the choice", () => {
    const w = fakeWindow("light", false);
    w.root.dataset.themeLock = "dark";
    applyRouteTheme("/", w.win);
    assert.equal(w.root.dataset.theme, "dark");
    assert.equal(w.root.dataset.themeChoice, "light");
    w.setOs(true);
    w.setOs(false);
    assert.equal(w.root.dataset.theme, "dark");
  });
});

describe("chooseTheme on a page locked Dark", () => {
  it("saves and shows the choice, and keeps the page Dark", () => {
    const w = fakeWindow(null, false);
    w.root.dataset.themeLock = "dark";
    const saved: string[] = [];
    chooseTheme("/", "light", {
      ...w.win,
      localStorage: { setItem: (_: string, v: string) => saved.push(v) }
    });
    assert.deepEqual(saved, ["light"]);
    assert.equal(w.root.dataset.themeChoice, "light");
    assert.equal(w.root.dataset.theme, "dark");
  });
});

// Some contexts throw on reading `window.localStorage` itself, not on getItem.
function blockedWindow() {
  const root = { dataset: {} as Record<string, string> };
  const media = {
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {}
  };
  const win = {
    get localStorage(): Storage {
      throw new DOMException("blocked", "SecurityError");
    },
    matchMedia: () => media,
    document: { documentElement: root }
  };
  return { win, root };
}

describe("blocked storage", () => {
  it("falls back to System when reading localStorage itself throws", () => {
    const { win, root } = blockedWindow();
    assert.doesNotThrow(() => applyRouteTheme("/blog", win));
    assert.equal(root.dataset.theme, "light");
  });

  it("still applies a chosen theme for the page when storage is blocked", () => {
    const { win, root } = blockedWindow();
    assert.doesNotThrow(() => chooseTheme("/blog", "light", win));
    assert.equal(root.dataset.theme, "light");
  });
});

describe("blocked storage and the OS", () => {
  it("keeps the reader's choice for the page when the OS changes", () => {
    const listeners = new Set<() => void>();
    const media = {
      matches: true,
      addEventListener: (_: string, f: () => void) => listeners.add(f),
      removeEventListener: (_: string, f: () => void) => listeners.delete(f)
    };
    const root = { dataset: {} as Record<string, string> };
    const win = {
      get localStorage(): Storage {
        throw new DOMException("blocked", "SecurityError");
      },
      matchMedia: () => media,
      document: { documentElement: root }
    };
    const stop = applyRouteTheme("/blog", win);
    chooseTheme("/blog", "light", win);
    media.matches = false;
    for (const f of listeners) f();
    assert.equal(root.dataset.theme, "light");
    stop();
  });
});

describe("read-only storage", () => {
  it("keeps the reader's new choice when saving it fails", () => {
    const listeners = new Set<() => void>();
    const media = {
      matches: true,
      addEventListener: (_: string, f: () => void) => listeners.add(f),
      removeEventListener: (_: string, f: () => void) => listeners.delete(f)
    };
    const root = { dataset: {} as Record<string, string> };
    const win = {
      localStorage: {
        getItem: () => "dark",
        setItem: () => {
          throw new DOMException("full", "QuotaExceededError");
        }
      },
      matchMedia: () => media,
      document: { documentElement: root }
    };
    const stop = applyRouteTheme("/blog", win);
    chooseTheme("/blog", "light", win);
    media.matches = false;
    for (const f of listeners) f();
    assert.equal(root.dataset.theme, "light");
    stop();
  });
});
