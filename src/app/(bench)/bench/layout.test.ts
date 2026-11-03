// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

// @vitest-environment node

import { JSDOM } from 'jsdom';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import RootLayout, { generateMetadata } from '@/app/(bench)/bench/layout';

// The stylesheets are Next.js's to build; loading them here would run bench's
// PostCSS config through Vite.
vi.mock('@/bench/styles/globals.css', () => ({}));
vi.mock('@/bench/styles/vortex-skin.css', () => ({}));

// The layout reads the request's host for the base of bench's paths.
const requestHeaders = vi.hoisted(() => new Headers({ host: 'bench.vortex.dev' }));
vi.mock('next/headers', () => ({ headers: async () => requestHeaders }));

const html = renderToStaticMarkup(await RootLayout({ children: createElement('main') }));

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

describe("the layout's icons", () => {
  const iconUrls = async (host: string) => {
    requestHeaders.set('host', host);
    try {
      const { icons } = await generateMetadata();
      return JSON.stringify(icons).match(/"url":"[^"]*"|"apple":"[^"]*"/g);
    } finally {
      requestHeaders.set('host', 'bench.vortex.dev');
    }
  };

  it('are at the root of bench.vortex.dev', async () => {
    expect(await iconUrls('bench.vortex.dev')).toEqual([
      '"url":"/icon-light.png"',
      '"url":"/icon-dark.png"',
      '"url":"/icon-dark.png"',
      '"apple":"/icon-dark.png"',
    ]);
  });

  it('are under /bench on any other host', async () => {
    expect(await iconUrls('localhost:3000')).toEqual([
      '"url":"/bench/icon-light.png"',
      '"url":"/bench/icon-dark.png"',
      '"url":"/bench/icon-dark.png"',
      '"apple":"/bench/icon-dark.png"',
    ]);
  });
});
