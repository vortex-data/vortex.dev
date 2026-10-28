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
  const themeable = pathname === "/blog" || pathname.startsWith("/blog/");
  if (!themeable) return "dark";
  if (stored === "light") return "light";
  if (stored === "system") return prefersDark ? "dark" : "light";
  return "dark";
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
    let stored: string | null = null;
    try {
      stored = win.localStorage.getItem("vx-theme");
    } catch {
      // Blocked storage means the default theme.
    }
    win.document.documentElement.dataset.theme = themeFor(
      pathname,
      stored,
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
