// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('./vortex-skin.css').replace(/\/\*[\s\S]*?\*\//g, '');

// The skin may change how bench looks, never how it works.
const VISUAL = new Set([
  'color',
  'background',
  'background-color',
  'border-color',
  'border-radius',
  'font-family',
  'font-weight',
]);

const decls = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(([, sel, body]) =>
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
const owns = (selector: string) => (d: { sel: string }) =>
  d.sel
    .split(',')
    .map((s) => s.trim())
    .includes(selector);
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
    expect(valueOf(":root[data-theme='dark']", '--accent')).toBe('#a5a0f8');
    expect(valueOf(":root[data-theme='light']", '--accent')).toBe('#1d0fed');
    expect(valueOf(":root[data-theme='dark']", '--page-bg')).toBe('#0f0f0e');
    expect(valueOf(":root[data-theme='dark']", '--card-bg')).toBe('#171716');
  });

  it('gives cards 6px corners and controls 4px', () => {
    expect(valueOf('.group-details', 'border-radius')).toBe('6px');
    for (const control of ['.control-btn', '.toolbar-btn', '.filter-chip']) {
      expect(valueOf(control, 'border-radius'), control).toBe('4px');
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
