// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('./globals.css');
const tokens = read('../../styles/vortex-tokens.css');
const layout = read('../../app/(bench)/bench/layout.tsx');

const declsOf = (source: string) =>
  [...source.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(
    ([, sel = '', body = '']) =>
      body
        .split(';')
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => ({
          sel: sel.trim(),
          prop: d.slice(0, d.indexOf(':')).trim(),
          value: d.slice(d.indexOf(':') + 1).trim(),
        })),
  );
const decls = declsOf(css);
const selectorsOf = (d: { sel: string }) => d.sel.split(',').map((s) => s.trim());
/** The last value globals.css gives `prop` on exactly `selector`, as the cascade would. */
const valueOf = (selector: string, prop: string) =>
  decls.filter((d) => selectorsOf(d).includes(selector) && d.prop === prop).at(-1)?.value;

// The system's colour roles, from the tokens stylesheet.
const ROLES = new Set([...tokens.matchAll(/^\s*--([a-z0-9-]+):/gm)].map((m) => m[1]));

// bench's own values, which the system has no role for: the tooltip (black in Light, raised in
// Dark), the green and red of a better or worse result with the text on that red, and the height
// of the sticky toolbar.
const OWN = new Set([
  '--tooltip-bg',
  '--tooltip-fg',
  '--good',
  '--bad',
  '--on-bad',
  '--toolbar-height',
]);

describe("bench's stylesheet on the system's tokens", () => {
  it('loads the tokens before globals.css, and has no skin layer', () => {
    const tokensAt = layout.indexOf("import '@/styles/vortex-tokens.css';");
    const globalsAt = layout.indexOf("import '@/bench/styles/globals.css';");
    expect(tokensAt).toBeGreaterThan(-1);
    expect(globalsAt).toBeGreaterThan(tokensAt);
    expect(layout).not.toMatch(/vortex-skin/);
    expect(existsSync(new URL('./vortex-skin.css', import.meta.url))).toBe(false);
  });

  it('renders data-theme="system", so the tokens follow the OS until a reader chooses', () => {
    expect(layout).toMatch(/<html[^>]*data-theme="system"/);
    expect(tokens).toMatch(
      /@media \(prefers-color-scheme: light\) \{\s*\[data-theme="system"\] \{/,
    );
  });

  it('defines only its own variables, and never redefines a token', () => {
    const defined = decls.filter((d) => d.prop.startsWith('--')).map((d) => d.prop);
    expect(defined.length).toBeGreaterThan(0);
    for (const name of defined) {
      expect(ROLES.has(name.slice(2)), `${name} redefines a token`).toBe(false);
      expect(OWN.has(name), `${name} is not one of bench's own`).toBe(true);
    }
  });

  it('reads every variable it uses from the tokens or from its own', () => {
    const used = new Set([...css.matchAll(/var\(--([a-z0-9-]+)/g)].map((m) => m[1]));
    for (const name of used) {
      expect(ROLES.has(name) || OWN.has(`--${name}`), name).toBe(true);
    }
  });

  // next/font names the faces and their metric-matched fallbacks (src/lib/fonts.ts), and the
  // tokens carry them, so bench names no face itself.
  it("draws text in the system's faces, through the --font-* tokens", () => {
    const families = decls.filter((d) => d.prop === 'font-family').map((d) => d.value);
    expect(families.length).toBeGreaterThan(3);
    for (const value of families) {
      expect(value, value).toMatch(/^(var\(--font-(sans|mono|display)\)|inherit)$/);
    }
  });

  it('writes its own colours only into its own variables', () => {
    const HEX = /#[0-9a-f]{3,8}\b/i;
    for (const d of decls.filter((x) => HEX.test(x.value))) {
      expect(OWN.has(d.prop), `${d.sel} ${d.prop}: ${d.value}`).toBe(true);
    }
  });

  // Words take accent-ink; fills take accent with on-accent text. In Light the two are one Blue.
  it('fills with accent and writes on it in on-accent', () => {
    for (const sel of ['.filter-badge', '.filter-chip--active']) {
      expect(valueOf(sel, 'background'), sel).toBe('var(--accent)');
      expect(valueOf(sel, 'color'), sel).toBe('var(--on-accent)');
    }
    expect(valueOf('.filter-chip--active:hover', 'border-color')).toBe('var(--accent)');
    expect(valueOf('.toolbar-slider', 'accent-color')).toBe('var(--accent)');
    expect(valueOf('.chart-range-strip-handle', 'background')).toBe('var(--accent)');
    expect(valueOf('a', 'color')).toBe('var(--accent-ink)');
  });

  // The system's States rule: a pressed switch sits on surface in ink inside a raised group, and
  // a switch is never Blue.
  it('draws the linear and log toggles as a switch, with no Blue', () => {
    expect(valueOf('.toolbar-btn', 'background')).toBe('var(--raised)');
    expect(valueOf('.toolbar-btn', 'color')).toBe('var(--ink-muted)');
    for (const sel of ['.toolbar-btn--active', '.toolbar-btn--active:hover']) {
      expect(valueOf(sel, 'background'), sel).toBe('var(--surface)');
      expect(valueOf(sel, 'border-color'), sel).toBe('var(--line)');
      expect(valueOf(sel, 'color'), sel).toBe('var(--ink)');
    }
  });

  it('gives cards 6px corners and controls 4px', () => {
    expect(valueOf('.group-details', 'border-radius')).toBe('6px');
    for (const control of ['.control-btn', '.toolbar-btn', '.filter-chip']) {
      expect(valueOf(control, 'border-radius'), control).toBe('4px');
    }
  });

  it('sets the title and toolbar buttons as mono labels, mutes ranks, and squares the badges', () => {
    for (const sel of ['.bench-title', '.control-btn']) {
      expect(valueOf(sel, 'font-family'), sel).toBe('var(--font-mono)');
    }
    expect(valueOf('.score-rank', 'color')).toBe('var(--ink-muted)');
    expect(valueOf('.bench-title', 'color')).toBe('var(--ink-muted)');
    for (const sel of ['.filter-badge', '.group-count']) {
      expect(valueOf(sel, 'border-radius'), sel).toBe('2px');
    }
  });

  // The system's label voice has no capitals and no tracking.
  it('writes every label in sentence case, untracked', () => {
    expect(decls.filter((d) => d.prop === 'text-transform').map((d) => d.sel)).toEqual([]);
    for (const d of decls.filter((x) => x.prop === 'letter-spacing')) {
      expect(d.value, d.sel).not.toMatch(/^0\.0[0-9]+em$/);
    }
  });

  // Cards and popovers stand on their borders, as the system's do. Only the tooltips, which sit
  // over a chart's lines, keep a shadow.
  it('draws no shadows but on the tooltips', () => {
    expect(decls.filter((d) => d.prop === 'box-shadow').map((d) => d.sel)).toEqual([
      '[data-tooltip].group-info-icon::after',
      '.chart-tooltip-host',
    ]);
  });

  it('sticks the toolbar at the top, on the ground, padded like the header', () => {
    expect(valueOf('.bench-toolbar', 'position')).toBe('sticky');
    // `hidden` on the root would make body a scroll container that never scrolls, and the
    // toolbar would stick to it, not to the window; `clip` clips without one.
    expect(valueOf('body', 'overflow-x')).toBe('clip');
    // The fixed Groups button needs room under the footer, or it covers the footer's mark.
    expect(valueOf('.bench-frame:has(.group-nav-toggle)', 'padding-bottom')).toBe('3.5rem');
    // On a phone the buttons' words hide, but the Filters count stays in view.
    expect(css).toMatch(/\.bench-toolbar-controls \.control-btn > span:not\(\.filter-badge\),/);
    expect(valueOf('.bench-toolbar', 'top')).toBe('0');
    expect(valueOf('.bench-toolbar', 'background')).toBe('var(--ground)');
    expect(valueOf('.bench-toolbar', 'padding')).toBe('0 var(--page-pad)');
    expect(valueOf('main', 'padding')).toBe('1rem var(--page-pad)');
    expect(css).not.toMatch(/sticky-header|site-title|repo-link|nav-controls|logo-link/);
  });
});
