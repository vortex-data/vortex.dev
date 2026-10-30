// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

// @vitest-environment node

import { JSDOM } from 'jsdom';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import RootLayout from '@/app/layout';

// The stylesheets are Next.js's to build; loading them here would run bench's
// PostCSS config through Vite.
vi.mock('./globals.css', () => ({}));
vi.mock('./vortex-skin.css', () => ({}));

const html = renderToStaticMarkup(createElement(RootLayout, null, createElement('main')));

/** Load the layout's markup in a browser-like document, scripts on or off. */
function load(runScripts: boolean, theme?: string): Document {
  return new JSDOM(`<!DOCTYPE html>${html}`, {
    url: 'https://bench.vortex.dev/',
    ...(runScripts ? { runScripts: 'dangerously' as const } : {}),
    beforeParse(window) {
      if (theme !== undefined) {
        window.localStorage.setItem('bench-theme', theme);
      }
    },
  }).window.document;
}

describe('RootLayout', () => {
  it('renders the root as no-js, which only a script swaps for js', () => {
    expect(html).toMatch(/^<html lang="en" class="no-js">/);
    expect(load(false).documentElement.className).toBe('no-js');
    expect(load(true).documentElement.className).toBe('js');
  });

  it('still applies a stored theme before first paint', () => {
    const doc = load(true, 'dark');
    expect(doc.documentElement.className).toBe('js');
    expect(doc.documentElement.dataset.theme).toBe('dark');
  });
});
