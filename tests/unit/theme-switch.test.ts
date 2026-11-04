import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chooseTheme,
  readChoice,
  saveChoice,
  THEME_CHANGE,
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

  it("is System when the choice is unset, unknown or blocked", () => {
    assert.equal(readChoice(fakeStorage(null)), "system");
    assert.equal(readChoice(fakeStorage("sepia")), "system");
    assert.equal(readChoice(fakeStorage("light", true)), "system");
    assert.equal(readChoice(null), "system");
  });

  it("reads the shared cookie before storage", () => {
    assert.equal(readChoice(fakeStorage("dark"), "vx-theme=light"), "light");
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

describe("chooseTheme", () => {
  function fakeWindow(
    stored: string | null,
    prefersDark: boolean,
    hostname = "vortex.dev"
  ) {
    const localStorage = fakeStorage(stored);
    const root = { dataset: {} as Record<string, string> };
    const events: { type: string; detail: unknown }[] = [];
    const document = {
      documentElement: root,
      cookie: "",
      dispatchEvent: (e: Event) => {
        events.push({ type: e.type, detail: (e as CustomEvent).detail });
        return true;
      }
    };
    return {
      localStorage,
      root,
      document,
      events,
      win: {
        localStorage,
        matchMedia: () => ({ matches: prefersDark }),
        location: { hostname, protocol: "https:" },
        document
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

  it("follows the choice on the homepage too", () => {
    const w = fakeWindow(null, true);
    chooseTheme("/", "light", w.win);
    assert.equal(w.root.dataset.theme, "light");
  });

  it("writes the cookie that shares the choice with docs, bench and the Explorer", () => {
    const w = fakeWindow(null, true, "bench.vortex.dev");
    chooseTheme("/", "light", w.win);
    assert.equal(
      w.document.cookie,
      "vx-theme=light; path=/; max-age=31536000; samesite=lax; domain=vortex.dev; secure"
    );
  });

  it("tells every switch on the page, so the header's and the Menu's agree", () => {
    const w = fakeWindow(null, true);
    chooseTheme("/blog", "dark", w.win);
    assert.deepEqual(w.events, [{ type: THEME_CHANGE, detail: "dark" }]);
  });
});
