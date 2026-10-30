// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { readdirSync, readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import * as icons from '@/components/icons';

const ICONS = Object.entries(icons);

describe('icons', () => {
  it('are Material Symbols Sharp: one filled path on the 960-unit grid', () => {
    expect(ICONS.map(([name]) => name).sort()).toEqual([
      'BookIcon',
      'CheckIcon',
      'CollapseAllIcon',
      'DarkModeIcon',
      'ExpandAllIcon',
      'FilterIcon',
      'InfoIcon',
      'LightModeIcon',
      'LinkIcon',
      'ListIcon',
      'MenuIcon',
    ]);
    for (const [name, Icon] of ICONS) {
      const html = renderToStaticMarkup(<Icon />);
      expect(html, name).toMatch(/^<svg [^>]*viewBox="0 -960 960 960"/);
      expect(html, name).toContain('fill="currentColor"');
      expect(html, name).toContain('aria-hidden="true"');
      expect(html, name).not.toContain('stroke');
      expect(html.match(/<path /g), name).toHaveLength(1);
    }
  });

  it('keep the class and size they are given', () => {
    const html = renderToStaticMarkup(<icons.MenuIcon className="btn-icon" size={18} />);
    expect(html).toContain('class="btn-icon"');
    expect(html).toContain('width="18"');
    expect(html).toContain('height="18"');
    expect(renderToStaticMarkup(<icons.LinkIcon />)).toContain('width="16"');
  });

  const dir = new URL('./', import.meta.url);
  const sources = readdirSync(dir).filter((f) => f.endsWith('.tsx') && !f.includes('.test.'));

  it('replace every stroke icon in the components', () => {
    expect(sources.length).toBeGreaterThan(5);
    for (const f of sources) {
      expect(readFileSync(new URL(f, dir), 'utf8'), f).not.toMatch(/stroke="currentColor"/);
    }
  });

  it('replace every text glyph that stood in for an icon', () => {
    for (const f of sources) {
      const code = readFileSync(new URL(f, dir), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(code, f).not.toMatch(/[ⓘℹ]/);
    }
  });
});
