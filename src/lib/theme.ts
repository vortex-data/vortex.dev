/**
 * Palette source of truth for TS-side consumers (OG image generation,
 * scripts). The CSS-side source lives in `src/app/globals.css` under
 * `:root`. The two MUST stay in sync — `scripts/verify.ts` enforces this in
 * CI for the values that exist on both sides.
 *
 * `background` is the design system's Dark ground (`--ground-dark`).
 *
 * If you change a palette value here, change it in `globals.css` too and
 * update the verify check's expected values.
 */
export const THEME = {
  background: "#0f0f0e",
  foreground: "#ffffff"
} as const;

export type ThemeKey = keyof typeof THEME;

/** The ThemeSwitch card's three choices, in its order. */
export const THEME_CHOICES = ["light", "dark", "system"] as const;

export type ThemeChoice = (typeof THEME_CHOICES)[number];

const THEME_KEY = "vx-theme";

/** Whether a page carries the ThemeSwitch: the blog index and its posts. */
export function isThemeable(pathname: string | null): boolean {
  return (
    pathname !== null && (pathname === "/blog" || pathname.startsWith("/blog/"))
  );
}

/** The stored choice, or Dark when it is unset, unknown or blocked. */
export function readChoice(
  storage: Pick<Storage, "getItem"> | null
): ThemeChoice {
  try {
    const v = storage?.getItem(THEME_KEY);
    return THEME_CHOICES.find((c) => c === v) ?? "dark";
  } catch {
    return "dark";
  }
}

/** Stores the choice. Blocked storage only costs the memory of it. */
export function saveChoice(
  storage: Pick<Storage, "setItem"> | null,
  choice: ThemeChoice
): void {
  try {
    storage?.setItem(THEME_KEY, choice);
  } catch {
    // The theme still changes for this page.
  }
}

/**
 * Which theme a page renders in. The blog carries the design system's
 * ThemeSwitch and follows the reader's choice in `localStorage["vx-theme"]`
 * (light, dark or system; Dark when unset). Every other page is Dark only.
 */
export function themeFor(
  pathname: string,
  stored: string | null,
  prefersDark: boolean
): "light" | "dark" {
  if (!isThemeable(pathname)) return "dark";
  if (stored === "light") return "light";
  if (stored === "system") return prefersDark ? "dark" : "light";
  return "dark";
}

/**
 * `win.localStorage`, or null where reading the property itself throws
 * (storage blocked by the browser or a sandbox), so callers fall back.
 */
function storageOf<S>(win: { readonly localStorage: S }): S | null {
  try {
    return win.localStorage;
  } catch {
    return null;
  }
}

/** What `applyRouteTheme` needs from `window`, so it can be tested without a DOM. */
export interface ThemeWindow {
  localStorage: Pick<Storage, "getItem">;
  matchMedia(query: string): {
    readonly matches: boolean;
    addEventListener(type: "change", listener: () => void): void;
    removeEventListener(type: "change", listener: () => void): void;
  };
  document: { documentElement: { dataset: DOMStringMap } };
}

/**
 * The ThemeSwitch's click: stores `choice` and sets `<html data-theme>` from
 * it at once. `applyRouteTheme`'s listener reads the stored choice again
 * when the OS changes, so System keeps following the OS afterwards.
 */
export function chooseTheme(
  pathname: string,
  choice: ThemeChoice,
  win: {
    localStorage: Pick<Storage, "setItem">;
    matchMedia(query: string): { readonly matches: boolean };
    document: { documentElement: { dataset: DOMStringMap } };
  }
): void {
  saveChoice(storageOf(win), choice);
  win.document.documentElement.dataset.theme = themeFor(
    pathname,
    choice,
    win.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

/**
 * Sets `<html data-theme>` for `pathname` and keeps it in step with the OS
 * while the page stays open, which a blog set to "system" needs. Returns a
 * function that stops listening.
 */
export function applyRouteTheme(
  pathname: string,
  win: ThemeWindow
): () => void {
  const media = win.matchMedia("(prefers-color-scheme: dark)");
  const apply = () => {
    win.document.documentElement.dataset.theme = themeFor(
      pathname,
      readChoice(storageOf(win)),
      media.matches
    );
  };
  apply();
  media.addEventListener("change", apply);
  return () => media.removeEventListener("change", apply);
}

/**
 * `themeFor` in plain ES5, for an inline classic script in `<head>` so the
 * theme lands on `<html>` before first paint. It is a constant: it reads the
 * path, the stored choice and the OS preference itself, and builds no code
 * from values. `tests/unit/theme.test.ts` holds it to `themeFor`.
 */
export const THEME_BOOTSTRAP =
  '(function(){var t="dark",p=location.pathname;' +
  'if(p==="/blog"||p.indexOf("/blog/")===0){var s=null;try{s=localStorage.getItem("vx-theme");}catch(e){}' +
  'if(s==="light")t="light";else if(s==="system")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}' +
  "document.documentElement.dataset.theme=t;})();";
