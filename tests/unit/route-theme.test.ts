import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyRouteTheme } from "@/lib/theme";

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

  it("keeps Dark-only pages dark when the OS changes", () => {
    const w = fakeWindow("system", true);
    applyRouteTheme("/", w.win);
    w.setOs(false);
    assert.equal(w.root.dataset.theme, "dark");
  });
});
