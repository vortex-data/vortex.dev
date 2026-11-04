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
// of the sticky header.
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

  it('gives cards the card radius and controls the control radius', () => {
    expect(valueOf('.group-details', 'border-radius')).toBe('var(--radius-card)');
    for (const control of ['.control-btn', '.toolbar-btn', '.filter-chip']) {
      expect(valueOf(control, 'border-radius'), control).toBe('var(--radius-control)');
    }
  });

  it("draws no radius off the system scale, except the square badges and the range strip's handles", () => {
    const parts = [...css.matchAll(/border-radius: ([^;]+);/g)].flatMap((m) =>
      (m[1] ?? '').split(' '),
    );
    const off = parts.filter((v) => !/^(var\(--radius-(card|control|full)\)|0|50%|2px)$/.test(v));
    expect(off, off.join(', ')).toEqual([]);
  });

  it('sets the header buttons as mono labels, mutes ranks, and squares the badges', () => {
    expect(valueOf('.control-btn', 'font-family')).toBe('var(--font-mono)');
    expect(valueOf('.score-rank', 'color')).toBe('var(--ink-muted)');
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

  // impeccable flags body text under 12px and functional text under 11px. The score tables'
  // footnotes and the compression table's "vs" labels were 11.5px and 10.9px.
  it('sets the score footnotes and column groups at 12px or more', () => {
    for (const sel of ['.scores-explanation', '.compression-size-group']) {
      const sizes = decls
        .filter((d) => selectorsOf(d).some((s) => s.endsWith(sel)) && d.prop === 'font-size')
        .map((d) => d.value);
      expect(sizes.length, sel).toBeGreaterThan(0);
      for (const v of sizes)
        expect(Number.parseFloat(v), `${sel} ${v}`).toBeGreaterThanOrEqual(0.75);
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

  // The system's header (has-tools) sticks and holds the controls, so bench draws no toolbar.
  it("puts the controls on the system's sticky header, and draws no toolbar of its own", () => {
    expect(css).not.toMatch(/\.bench-toolbar[\s,{]|\.bench-title/);
    expect(valueOf(':root', '--toolbar-height')).toBe('64px');
    // `hidden` on the root would make body a scroll container that never scrolls, and the
    // header would stick to it, not to the window; `clip` clips without one.
    expect(valueOf('body', 'overflow-x')).toBe('clip');
    // The fixed Groups button needs room under the footer, or it covers the footer's mark.
    expect(valueOf('.bench-frame:has(.group-nav-toggle)', 'padding-bottom')).toBe('3.5rem');
    // Below 1260px the buttons' words hide, but the Filters count stays in view.
    expect(css).toMatch(
      /@media \(max-width: 1260px\) \{\s*\.bench-toolbar-controls \.vx-btn > span:not\(\.filter-badge\),/,
    );
    // The header's buttons are the system's (vx-btn), and bench restyles none of them.
    expect(css).not.toMatch(
      /\.vx-header[^{}]*\.(control-btn|vx-btn)\b[^{}]*\{[^}]*(background|border|font|height)/,
    );
    // At 320px the controls keep room before the Menu button.
    expect(css).toMatch(
      /@media \(max-width: 400px\) \{\s*\.vx-header-tools \.vx-btn \{\s*padding-inline: 0\.4rem;/,
    );
    expect(valueOf('main', 'padding')).toBe('var(--space-16) var(--page-pad)');
    expect(css).not.toMatch(/sticky-header|site-title|repo-link|nav-controls|logo-link/);
  });

  // The groups speak in the system's mono voice, as the header's label does, and Blue marks
  // Vortex's rows only: the other formats' scores are in ink-body.
  it('sets group names and scores in mono, with Blue only on Vortex', () => {
    for (const sel of ['.group-name', '.scores-title', '.score-item']) {
      expect(valueOf(sel, 'font-family'), sel).toBe('var(--font-mono)');
    }
    // Will's B (2026-11-03): weight 400 at 13px read too thin, Light most of all.
    expect(valueOf('.group-name', 'font-weight')).toBe('600');
    expect(valueOf('.scores-title', 'font-size')).toBe('13px');
    expect(valueOf('.scores-title', 'color')).toBe('var(--ink-body)');
    expect(valueOf('.score-item', 'font-size')).toBe('14px');
    expect(valueOf('.score-series', 'font-weight')).toBe('500');
    expect(valueOf('.score-value', 'color')).toBe('var(--ink-body)');
    expect(
      decls.some(
        (d) =>
          d.sel.includes('.is-ours') &&
          d.sel.includes('.score-value') &&
          d.value === 'var(--accent-ink)',
      ),
    ).toBe(true);
    // On a phone 20px pushes the group's icons onto lines of their own, so one rule sets 17px.
    expect(
      decls
        .filter((d) => selectorsOf(d).includes('.group-name') && d.prop === 'font-size')
        .map((d) => d.value),
    ).toEqual(['20px', '17px']);
    expect(css).toMatch(/@media \(max-width: 640px\) \{\s*\.group-name \{\s*font-size: 17px;/);
  });

  it('clips sideways overflow on html and body, so sticky headers keep working', () => {
    for (const sel of ['html', 'body']) {
      expect(valueOf(sel, 'overflow-x'), sel).toBe('clip');
    }
  });

  it('shows a press on every control, and a press does not move it', () => {
    const controls = [
      '.control-btn',
      '.toolbar-btn',
      '.filter-chip',
      '.filter-chip--active',
      '.group-toolbar-reset',
      '.group-toolbar-empty-toggle',
      '.group-filter-trigger',
      '.group-permalink',
      '.group-docs-link',
      '.group-nav-link',
      '.chart-window-chip',
      '.chart-error-retry',
    ];
    const pressed = decls.filter((d) => d.sel.includes(':active'));
    for (const control of controls) {
      const own = pressed.filter((d) =>
        selectorsOf(d).some((s) => new RegExp(`\\${control}(?![\\w-])[^,]*:active`).test(s)),
      );
      expect(own.length, control).toBeGreaterThan(0);
      for (const d of own) expect(d.value, `${control} ${d.prop}`).not.toMatch(/translate|scale/);
    }
    // The window chip is clickable in two states: "windowed" loads the full history, and "error"
    // retries it.
    for (const state of ['windowed', 'error']) {
      const sel = `.chart-window-chip[data-state='${state}']:not(:disabled):active`;
      expect(valueOf(sel, 'background'), sel).toBeDefined();
    }
  });
});
