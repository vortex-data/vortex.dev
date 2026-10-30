// The theme choice shared by docs, the blog and the Explorer (and bench once it adopts the
// ThemeSwitch): light, dark or system.
// It lives in localStorage["vx-theme"] and lands on <html data-theme>. The default is Dark.
// The choice itself also lands on <html data-theme-choice>, so the switch can show it pressed
// before its script runs.
//
// A site whose other pages are Dark only passes `themeable`, a list of path prefixes: "/blog"
// covers /blog and every page under it. Pages outside the list stay Dark whatever the choice.
// It is a list and not a function because the bootstrap carries it into an inline script as data.
const KEY = "vx-theme";
const CHOICES = ["light", "dark", "system"];
const PLAIN_PATH = /^\/[\w.~\/-]*$/;

// "/blog/" and "/blog" are one prefix. "/" stays "/".
const trim = (prefix) => (prefix.length > 1 ? prefix.replace(/\/+$/, "") : prefix);

/** Whether `path` takes the reader's theme. With no list, every path does. */
export function isThemeable(path, themeable) {
  if (!themeable) return true;
  return themeable.map(trim).some((p) => path === p || path.startsWith(p === "/" ? "/" : `${p}/`));
}

/**
 * The no-flash snippet for a site where only `themeable` paths follow the choice (every path when
 * it is left out). Paste it into an inline classic <script> in <head>, before the stylesheets, so
 * the theme lands on <html> before first paint. A module script runs too late for this. It repeats
 * readChoice, isThemeable and resolveTheme in plain ES5, because it cannot import them. The paths
 * go in as JSON, and only plain paths are allowed, so no value becomes code.
 */
export function themeBootstrap({ themeable } = {}) {
  let list = "null";
  if (themeable) {
    for (const p of themeable) if (typeof p !== "string" || !PLAIN_PATH.test(p)) throw new Error(`themeable takes a plain path such as "/blog", not ${JSON.stringify(p)}`);
    list = JSON.stringify(themeable.map(trim));
  }
  return (
    `(function(){var r=document.documentElement,c="dark",t=${list},ok=!t;` +
    'if(t){var p=location.pathname;for(var i=0;i<t.length;i++)if(p===t[i]||p.indexOf(t[i]==="/"?"/":t[i]+"/")===0)ok=true;}' +
    'try{var s=localStorage.getItem("vx-theme");if(s==="light"||s==="dark"||s==="system")c=s;}catch(e){}' +
    'r.dataset.themeChoice=c;var m=c;if(m==="system")m=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";' +
    'r.dataset.theme=ok?m:"dark";})();'
  );
}

/** The snippet for a site where every page follows the choice. */
export const THEME_BOOTSTRAP = themeBootstrap();

export function readChoice(storage) {
  try {
    const v = storage?.getItem(KEY);
    return CHOICES.includes(v) ? v : "dark";
  } catch {
    return "dark";
  }
}

export function saveChoice(storage, choice) {
  try {
    storage?.setItem(KEY, choice);
  } catch {
    // Blocked storage only costs the memory of the choice.
  }
}

export function resolveTheme(choice, prefersDark) {
  if (choice === "system") return prefersDark ? "dark" : "light";
  return choice === "light" ? "light" : "dark";
}

/** The theme a page shows: the choice on a themeable path, else Dark. */
export function themeFor(choice, prefersDark, { path = "/", themeable } = {}) {
  return isThemeable(path, themeable) ? resolveTheme(choice, prefersDark) : "dark";
}

const store = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};
const dark = () => matchMedia("(prefers-color-scheme: dark)");

// Sets data-theme and data-theme-choice from the stored choice. `themeable` and `path` (the
// current page's by default) keep a page outside the list Dark.
export function applyTheme(choice = readChoice(store()), { themeable, path = location.pathname } = {}) {
  const root = document.documentElement;
  root.dataset.themeChoice = choice;
  root.dataset.theme = themeFor(choice, dark().matches, { path, themeable });
  return choice;
}

// Wires a .vx-theme-switch: buttons carry data-choice and aria-pressed.
// With { apply: false } it shows the current theme without changing it on load.
// `themeable` is the same list the bootstrap took.
export function mountThemeSwitch(el, { apply = true, themeable } = {}) {
  const buttons = [...el.querySelectorAll("button[data-choice]")];
  let choice = apply ? applyTheme(undefined, { themeable }) : readChoice(store());
  if (!apply) choice = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  const press = () => buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.choice === choice)));
  buttons.forEach((b) =>
    b.addEventListener("click", () => {
      choice = b.dataset.choice;
      saveChoice(store(), choice);
      applyTheme(choice, { themeable });
      press();
    }),
  );
  dark().addEventListener("change", () => choice === "system" && applyTheme(choice, { themeable }));
  press();
}
