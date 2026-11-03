import {
  isThemeable as onThemeablePath,
  saveChoice,
  type ThemeChoice,
  themeBootstrap,
  themeFor
} from "@/vendor/vortex-design/theme.js";

/**
 * Palette source of truth for TS-side consumers (OG image generation,
 * scripts). The CSS-side source lives in `src/app/(site)/globals.css` under
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
 * The first statement of the first-paint script: it swaps the root's
 * server-rendered `no-js` class for `js`, so `.no-js [data-requires-js]`
 * (globals.css) hides the controls that do nothing without JavaScript only
 * when no script runs. A constant, as the rest of the script is.
 */
const NO_JS_SWAP =
  'document.documentElement.className=document.documentElement.className.replace("no-js","js");';

/**
 * On the homepage only, before first paint: whether the browser can give the
 * ASCII mark a WebGL context. The root gets `webgl` or `no-webgl`, and with
 * `no-webgl` the page lays out without the mark from the first frame
 * (src/app/page.module.css), so it does not jump when the mark later reports
 * that it cannot draw. The probe's context is released at once, so the mark
 * can make its own. A link from another page renders the homepage with no
 * new document, so `probeWebgl` does the same then.
 */
const WEBGL_PROBE =
  'if(location.pathname==="/"){var w=false;try{var g=document.createElement("canvas").getContext("webgl2")||document.createElement("canvas").getContext("webgl");if(g){w=true;var x=g.getExtension("WEBGL_lose_context");x&&x.loseContext()}}catch(e){}document.documentElement.className+=w?" webgl":" no-webgl"}';

/**
 * The first-paint script's WebGL probe, for a homepage that a link renders in
 * place. The ASCII mark runs it in a layout effect, so the class is on the
 * root before the frame is painted. It probes once per document.
 */
export function probeWebgl(doc: Document = document): void {
  const root = doc.documentElement;
  if (root.classList.contains("webgl") || root.classList.contains("no-webgl"))
    return;
  let ok = false;
  try {
    const canvas = doc.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (gl) {
      ok = true;
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  } catch {}
  root.classList.add(ok ? "webgl" : "no-webgl");
}

/**
 * The first-paint script for this site's paths: the `no-js` swap, the
 * homepage's WebGL probe, then the
 * design system's script, which sets `<html data-theme>` (Dark outside the
 * blog) and `data-theme-choice`, from which the system's CSS shows the
 * switch's choice pressed before hydration.
 */
export const THEME_BOOTSTRAP =
  NO_JS_SWAP + WEBGL_PROBE + themeBootstrap({ themeable: THEMEABLE });

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
