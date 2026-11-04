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
vi.mock('@/styles/vortex-tokens.css', () => ({}));
vi.mock('@/styles/vortex.css', () => ({}));
// The site's footer, as a stand-in that shows the props bench gives it. Each page renders the
// header (BenchHeader), because the filter dropdown takes the page's data.
vi.mock('@/components/layout/footer', () => ({
  Footer: ({ origin, solid }: { origin: string; solid: boolean }) =>
    createElement('footer', { 'data-origin': origin, 'data-solid': String(solid) }),
}));
// next/font is a build step; its classes set the design system's --vx-face-* variables.
vi.mock('@/lib/fonts', () => ({ FONT_CLASSES: 'face-sans face-mono' }));

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
    expect(html).toMatch(/^<html lang="en" data-theme="system" class="no-js /);
    expect(load(false).documentElement.classList.contains('no-js')).toBe(true);
    expect(load(true).documentElement.classList.contains('js')).toBe(true);
    expect(load(true).documentElement.classList.contains('no-js')).toBe(false);
  });

  it('still applies a stored theme before first paint', () => {
    const doc = load(true, 'dark');
    expect(doc.documentElement.classList.contains('js')).toBe(true);
    expect(doc.documentElement.dataset.theme).toBe('dark');
  });

  it("self-hosts the system's faces, as the site does, with no request to Google Fonts", () => {
    expect(load(false).documentElement.className).toBe('no-js face-sans face-mono');
    expect(html).not.toMatch(/googleapis|gstatic/);
  });

  it('follows the OS until a reader chooses a theme', () => {
    expect(load(true).documentElement.dataset.theme).toBe('system');
    expect(load(false).documentElement.dataset.theme).toBe('system');
  });
});

describe("the layout's skip link", () => {
  it('is the first thing in the body, and names the main by a fragment that works on either base', () => {
    const body = load(false).body;
    const first = body.firstElementChild;
    expect(first?.tagName).toBe('A');
    expect(first?.className).toBe('vx-skip-link');
    expect(first?.getAttribute('href')).toBe('#main');
    expect(first?.textContent).toBe('Skip to content');
  });
});

describe("the layout's frame", () => {
  it("puts every page above the site's footer, pointed at the site, with a solid rule", () => {
    expect(html).toMatch(
      /<div class="bench-frame"><main><\/main><footer data-origin="https:\/\/vortex.dev" data-solid="true"><\/footer><\/div>/,
    );
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
