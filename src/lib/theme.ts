import {
  readChoice,
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
 * The event a switch fires on `document` when the reader picks a theme, so
 * every switch on the page shows it: the header's and its twin in the Menu
 * panel. The design system's theme module fires the same one.
 */
export const THEME_CHANGE = "vx-theme:change";

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
 * (src/app/(site)/page.module.css), so it does not jump when the mark later reports
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
 * The site's paths that follow the reader's theme: the blog. The homepage
 * and the 404 stay Dark whatever the choice; in Light they were too bright.
 * A new page that should follow the choice goes in this list.
 */
export const SITE_THEMEABLE = ["/blog"];

/**
 * The first-paint script for this site's paths: the `no-js` swap, the
 * homepage's WebGL probe, then the
 * design system's script, which sets `<html data-theme>` from the reader's
 * choice (the `vx-theme` cookie that vortex.dev's subdomains share, else
 * storage, else System) on the blog, and Dark elsewhere, and
 * `data-theme-choice`, from which the system's CSS shows the switch's choice
 * pressed before hydration.
 */
export const THEME_BOOTSTRAP =
  NO_JS_SWAP + WEBGL_PROBE + themeBootstrap({ themeable: SITE_THEMEABLE });

/**
 * The script `DarkOnly` writes ahead of a Dark-only page (the homepage and
 * the 404): `<html data-theme-lock="dark">`, which keeps the page Dark when
 * the switch, the OS, or a route change applies the theme again, and Dark at
 * once. bench's 404 needs it before first paint, because bench's bootstrap
 * cannot tell a 404 from its path. The choice itself is left as it is.
 */
export const DARK_LOCK_SCRIPT =
  'document.documentElement.dataset.themeLock="dark";document.documentElement.dataset.theme="dark";';

/**
 * bench's first-paint script: the same `no-js` swap and theme, without the
 * homepage's WebGL probe, which bench's own "/" does not need.
 */
export const BENCH_THEME_BOOTSTRAP = NO_JS_SWAP + themeBootstrap();

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

/** `doc.cookie`, or "" where there is none or reading it throws. */
export function cookieOf(doc: { readonly cookie?: string }): string {
  try {
    return doc.cookie ?? "";
  } catch {
    return "";
  }
}

/**
 * The reader's choice on this page if they made one (their latest action,
 * even when saving it failed), else the shared cookie's, else the stored
 * choice, else System.
 */
function currentChoice(win: {
  readonly localStorage: Pick<Storage, "getItem">;
  document: object;
}): ThemeChoice {
  return (
    pageChoices.get(win.document) ??
    readChoice(storageOf(win), cookieOf(win.document))
  );
}

type Root = { documentElement: { dataset: DOMStringMap } };

// Sets the page's theme, and the choice the switch shows, as the bootstrap
// does. A page that `DarkOnly` locks stays Dark.
function apply(
  root: Root,
  pathname: string,
  choice: ThemeChoice,
  prefersDark: boolean
): void {
  const { dataset } = root.documentElement;
  dataset.themeChoice = choice;
  dataset.theme =
    dataset.themeLock === "dark"
      ? "dark"
      : themeFor(choice, prefersDark, { path: pathname });
}

/**
 * Locks the page Dark (`DARK_LOCK_SCRIPT`), for a Dark-only page that a link
 * renders in place. Returns a function that lifts the lock; the next route's
 * `applyRouteTheme` then sets that route's theme.
 */
export function lockDark(doc: Root = document): () => void {
  const { dataset } = doc.documentElement;
  dataset.themeLock = "dark";
  dataset.theme = "dark";
  return () => {
    delete dataset.themeLock;
  };
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
 * The ThemeSwitch's click: stores `choice` in the shared cookie and in
 * storage, sets `<html data-theme>` from it at once, and tells every switch
 * on the page (`THEME_CHANGE`). `applyRouteTheme`'s listener reads the choice
 * again when the OS changes, so System keeps following the OS afterwards.
 */
export function chooseTheme(
  pathname: string,
  choice: ThemeChoice,
  win: {
    localStorage: Pick<Storage, "setItem">;
    matchMedia(query: string): { readonly matches: boolean };
    location?: { readonly hostname: string; readonly protocol: string };
    document: Root & {
      cookie?: string;
      dispatchEvent?(e: Event): boolean;
    };
  }
): void {
  pageChoices.set(win.document, choice);
  saveChoice(storageOf(win), choice, {
    jar: "cookie" in win.document ? (win.document as { cookie: string }) : null,
    ...(win.location && {
      hostname: win.location.hostname,
      secure: win.location.protocol === "https:"
    })
  });
  apply(
    win.document,
    pathname,
    choice,
    win.matchMedia("(prefers-color-scheme: dark)").matches
  );
  win.document.dispatchEvent?.(
    new CustomEvent(THEME_CHANGE, { detail: choice })
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
