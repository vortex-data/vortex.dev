// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

// The skin may change how bench looks, never how it works.
const VISUAL = new Set([
  'color',
  'background',
  'background-color',
  'border-color',
  'border-radius',
  'accent-color',
  'font-family',
  'font-weight',
  // The label voice: size, tracking, and case change how text looks.
  'font-size',
  'letter-spacing',
  'text-transform',
]);

const declsOf = (path: string) =>
  [
    ...read(path)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .matchAll(/([^{}]+)\{([^{}]*)\}/g),
  ].flatMap(([, sel = '', body = '']) =>
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
const decls = declsOf('./vortex-skin.css');
const selectorsOf = (d: { sel: string }) => d.sel.split(',').map((s) => s.trim());
const owns = (selector: string) => (d: { sel: string }) => selectorsOf(d).includes(selector);
const valueOf = (selector: string, prop: string) =>
  decls.find((d) => owns(selector)(d) && d.prop === prop)?.value;

describe('vortex-skin.css', () => {
  it('sets only visual properties', () => {
    expect(decls.length).toBeGreaterThan(10);
    for (const d of decls) {
      expect(d.prop.startsWith('--') || VISUAL.has(d.prop), `${d.sel} sets ${d.prop}`).toBe(true);
    }
  });

  it('uses the Blue accent and warm greys in both themes', () => {
    expect(valueOf(":root[data-theme='dark']", '--accent')).toBe('#8fa9ff');
    expect(valueOf(":root[data-theme='light']", '--accent')).toBe('#1d0fed');
    expect(valueOf(":root[data-theme='dark']", '--page-bg')).toBe('#0f0f0e');
    expect(valueOf(":root[data-theme='dark']", '--card-bg')).toBe('#171716');
  });

  // Bench's one --accent is both the Blue for words and the Blue for fills. The system splits
  // them in Dark: words take blue-soft, fills take blue-bright with white text.
  const DARK = [":root[data-theme='dark']", ":root:not([data-theme='light'])"];
  const LIGHT = [':root', ":root[data-theme='light']"];

  it('gives Dark fills blue-bright and keeps blue-soft for words', () => {
    for (const sel of DARK) {
      expect(valueOf(sel, '--accent'), sel).toBe('#8fa9ff');
      expect(valueOf(sel, '--accent-fill'), sel).toBe('#2f63ff');
      expect(valueOf(sel, '--accent-fill-fg'), sel).toBe('#ffffff');
    }
    for (const sel of LIGHT) {
      expect(valueOf(sel, '--accent-fill'), sel).toBe('#1d0fed');
      expect(valueOf(sel, '--accent-fill-fg'), sel).toBe('#ffffff');
    }
  });

  // The linear and log toggles are a switch, which the system draws without Blue (below).
  const SWITCH = '.toolbar-btn';

  it('repaints every rule where bench fills with the accent', () => {
    const globals = declsOf('./globals.css');
    const FILL = new Set(['background', 'background-color', 'accent-color']);
    const fills = new Set(
      globals
        .filter((d) => FILL.has(d.prop) && d.value === 'var(--accent)')
        .flatMap(selectorsOf)
        .filter((s) => !s.startsWith(SWITCH)),
    );
    expect(fills.size).toBeGreaterThan(3);
    const isFill = (s: string) => [...fills].some((f) => s === f || s.startsWith(`${f}:`));
    for (const d of globals) {
      for (const sel of selectorsOf(d).filter(isFill)) {
        if (d.value === 'var(--accent)') {
          expect(valueOf(sel, d.prop), `${sel} ${d.prop}`).toBe('var(--accent-fill)');
        }
        if (d.value === 'var(--accent-fg)') {
          expect(valueOf(sel, d.prop), `${sel} ${d.prop}`).toBe('var(--accent-fill-fg)');
        }
      }
    }
  });

  it("keeps an active control's border on its fill when hovered", () => {
    // Bench's .filter-chip:hover would ring the fill in the word Blue.
    expect(valueOf('.filter-chip--active:hover', 'border-color')).toBe('var(--accent-fill)');
  });

  // The system's States rule: a pressed switch sits on surface in ink inside a raised group, and
  // a switch is never Blue. The skin cannot move anything, so the options draw the group.
  it('draws the linear and log toggles as a switch, with no Blue', () => {
    for (const sel of DARK) expect(valueOf(sel, '--raised'), sel).toBe('#2b2b29');
    for (const sel of LIGHT) expect(valueOf(sel, '--raised'), sel).toBe('#ebebe8');
    expect(valueOf('.toolbar-btn', 'background')).toBe('var(--raised)');
    expect(valueOf('.toolbar-btn', 'color')).toBe('var(--muted)');
    for (const sel of ['.toolbar-btn--active', '.toolbar-btn--active:hover']) {
      expect(valueOf(sel, 'background'), sel).toBe('var(--card-bg)');
      expect(valueOf(sel, 'border-color'), sel).toBe('var(--border)');
      expect(valueOf(sel, 'color'), sel).toBe('var(--fg)');
    }
    for (const d of decls.filter((x) => selectorsOf(x).some((s) => s.startsWith(SWITCH)))) {
      expect(d.value, `${d.sel} ${d.prop}`).not.toMatch(/accent/);
    }
  });

  it("gives Dark muted text the system's grey-450, a step below body text", () => {
    for (const sel of DARK) expect(valueOf(sel, '--muted'), sel).toBe('#9c9c99');
  });

  it('gives cards 6px corners and controls 4px', () => {
    expect(valueOf('.group-details', 'border-radius')).toBe('6px');
    for (const control of ['.control-btn', '.toolbar-btn', '.filter-chip']) {
      expect(valueOf(control, 'border-radius'), control).toBe('4px');
    }
  });

  it('sets the title and toolbar buttons as mono labels, mutes ranks, and squares the badges', () => {
    for (const sel of ['.site-title', '.control-btn']) {
      expect(valueOf(sel, 'font-family'), sel).toMatch(/Geist Mono/);
      expect(valueOf(sel, 'text-transform'), sel).toBe('uppercase');
    }
    expect(valueOf('.score-rank', 'color')).toBe('var(--muted)');
    expect(valueOf('.site-title', 'color')).toBe('var(--muted)');
    for (const sel of ['.filter-badge', '.group-count']) {
      expect(valueOf(sel, 'border-radius'), sel).toBe('2px');
    }
  });

  it('loads after globals.css in the root layout', () => {
    const layout = read('./layout.tsx');
    const globals = layout.indexOf("import './globals.css';");
    const skin = layout.indexOf("import './vortex-skin.css';");
    expect(globals).toBeGreaterThan(-1);
    expect(skin).toBeGreaterThan(globals);
  });
});
