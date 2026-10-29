import {
  isThemeable as onThemeablePath,
  saveChoice,
  type ThemeChoice,
  themeBootstrap,
  themeFor
} from "@/vendor/vortex-design/theme.js";

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

export {
  readChoice,
  saveChoice,
  themeFor
} from "@/vendor/vortex-design/theme.js";
export type { ThemeChoice };

/** The ThemeSwitch card's three choices, in its order. */
export const THEME_CHOICES = [
  "light",
  "dark",
  "system"
] as const satisfies readonly ThemeChoice[];

/**
 * The paths that carry the ThemeSwitch: the blog index and its posts. Every
 * other page is Dark only. The design system's theme module takes the list.
 */
export const THEMEABLE = ["/blog"] as const;

const THEME_KEY = "vx-theme";

/** Whether a page carries the ThemeSwitch. */
export function isThemeable(pathname: string | null): boolean {
  return pathname !== null && onThemeablePath(pathname, THEMEABLE);
}

/**
 * The design system's first-paint script for this site's paths. It sets
 * `<html data-theme>` (Dark outside the blog) and `data-theme-choice`, from
 * which the system's CSS shows the switch's choice pressed before hydration.
 */
export const THEME_BOOTSTRAP = themeBootstrap({ themeable: THEMEABLE });

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

/**
 * The choice the reader made on this page, keyed by its document. Storage
 * may be blocked or full, so this is what keeps a choice alive until the
 * page goes away.
 */
const pageChoices = new WeakMap<object, ThemeChoice>();

/**
 * The reader's choice on this page if they made one (their latest action,
 * even when saving it failed), else the stored choice, else Dark.
 */
function currentChoice(win: {
  readonly localStorage: Pick<Storage, "getItem">;
  document: object;
}): ThemeChoice {
  let stored: string | null = null;
  try {
    stored = storageOf(win)?.getItem(THEME_KEY) ?? null;
  } catch {
    // Blocked storage: fall back to this page's choice.
  }
  return (
    pageChoices.get(win.document) ??
    THEME_CHOICES.find((c) => c === stored) ??
    "dark"
  );
}

type Root = { documentElement: { dataset: DOMStringMap } };

// Sets the page's theme, and the choice the switch shows, as the bootstrap does.
function apply(
  root: Root,
  pathname: string,
  choice: ThemeChoice,
  prefersDark: boolean
): void {
  const { dataset } = root.documentElement;
  dataset.themeChoice = choice;
  dataset.theme = themeFor(choice, prefersDark, {
    path: pathname,
    themeable: THEMEABLE
  });
}

/** What `applyRouteTheme` needs from `window`, so it can be tested without a DOM. */
export interface ThemeWindow {
  localStorage: Pick<Storage, "getItem">;
  matchMedia(query: string): {
    readonly matches: boolean;
    addEventListener(type: "change", listener: () => void): void;
    removeEventListener(type: "change", listener: () => void): void;
  };
  document: Root;
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
    document: Root;
  }
): void {
  pageChoices.set(win.document, choice);
  saveChoice(storageOf(win), choice);
  apply(
    win.document,
    pathname,
    choice,
    win.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

/**
 * Sets `<html data-theme>` for `pathname` and keeps it in step with the OS
 * while the page stays open, which a blog set to "system" needs. Client-side
 * navigation keeps the document, so the first-paint script never reruns.
 * Returns a function that stops listening.
 */
export function applyRouteTheme(
  pathname: string,
  win: ThemeWindow
): () => void {
  const media = win.matchMedia("(prefers-color-scheme: dark)");
  const run = () =>
    apply(win.document, pathname, currentChoice(win), media.matches);
  run();
  media.addEventListener("change", run);
  return () => media.removeEventListener("change", run);
}
