// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { describe, expect, it } from 'vitest';

import { FONTS_CSS } from '@/lib/fonts';

describe('FONTS_CSS', () => {
  it('loads Funnel Display, Geist and Geist Mono from Google Fonts in one request', () => {
    const url = new URL(FONTS_CSS);
    expect(url.origin).toBe('https://fonts.googleapis.com');
    expect(url.searchParams.getAll('family')).toEqual([
      'Funnel Display:wght@400;500;600;700',
      'Geist:wght@400;500;600',
      'Geist Mono:wght@400;500;600',
    ]);
    expect(url.searchParams.get('display')).toBe('swap');
  });
});

describe('the font bootstrap in the root layout', () => {
  it('writes out the same URL as FONTS_CSS, so the inline script stays a constant', async () => {
    const { readFileSync } = await import('node:fs');
    const layout = readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8');
    const script = layout.slice(
      layout.indexOf('const FONT_BOOTSTRAP'),
      layout.indexOf(';\n', layout.indexOf('const FONT_BOOTSTRAP')),
    );
    expect(script).toContain(`l.href="${FONTS_CSS}"`);
    expect(script).not.toContain('${');
  });
});
