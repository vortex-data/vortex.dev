// Types for theme.js, shipped beside it.

export type ThemeChoice = "light" | "dark" | "system";
export type Theme = "light" | "dark";

/** Path prefixes whose pages follow the reader's choice: "/blog" covers /blog and /blog/…. */
export type Themeable = readonly string[];

export function isThemeable(path: string, themeable?: Themeable): boolean;
export function themeBootstrap(options?: { themeable?: Themeable }): string;
export const THEME_BOOTSTRAP: string;
export function readChoice(storage: Pick<Storage, "getItem"> | null | undefined): ThemeChoice;
export function saveChoice(storage: Pick<Storage, "setItem"> | null | undefined, choice: ThemeChoice): void;
export function resolveTheme(choice: string, prefersDark: boolean): Theme;
export function themeFor(choice: string, prefersDark: boolean, options?: { path?: string; themeable?: Themeable }): Theme;
export function applyTheme(choice?: ThemeChoice, options?: { path?: string; themeable?: Themeable }): ThemeChoice;
export function mountThemeSwitch(el: Element, options?: { apply?: boolean; themeable?: Themeable }): void;
