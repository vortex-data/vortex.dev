/**
 * Palette source of truth for TS-side consumers (OG image generation,
 * scripts). The CSS-side source lives in `src/app/globals.css` under
 * `:root` (and `@theme inline` aliases). The two MUST stay in sync —
 * `scripts/verify.ts` enforces this in CI for the values that exist on
 * both sides.
 *
 * `foreground` is currently white-on-dark and shows up in the site as the
 * built-in Tailwind `text-white` (no `--color-foreground` CSS variable).
 * We track it here anyway so the OG components have a single name to
 * import, and so a future move to a CSS-side `--color-foreground` token
 * has an obvious destination.
 *
 * If you change a palette value here, change it in `globals.css` too and
 * update the verify check's expected values.
 */
export const THEME = {
  background: "#101010",
  foreground: "#ffffff"
} as const;

export type ThemeKey = keyof typeof THEME;
