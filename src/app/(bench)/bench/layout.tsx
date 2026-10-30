// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { FONTS_CSS } from '@/lib/fonts';

import './globals.css';
// The Vortex design system's skin: colours, corners and Geist over globals.css.
import './vortex-skin.css';

export const metadata: Metadata = {
  title: 'Vortex Benchmarks',
  description: 'Continuous benchmark results for Vortex.',
  // Theme-aware favicons, ported from `render.rs::favicon_links`: the black
  // sigil on light-mode tabs, the white sigil on dark-mode tabs, with the dark
  // sigil as the unmediated fallback (and the apple-touch icon).
  icons: {
    icon: [
      { url: '/icon-light.png', media: '(prefers-color-scheme: light)' },
      { url: '/icon-dark.png', media: '(prefers-color-scheme: dark)' },
      { url: '/icon-dark.png' },
    ],
    apple: '/icon-dark.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

// The pre-paint bootstrap. Its first statement swaps the root's server-rendered
// `no-js` class for `js`, so `.no-js [data-requires-js]` (globals.css) hides
// the controls that do nothing without JavaScript only when no script runs.
// The rest is ported verbatim from `render.rs::theme_bootstrap_script`: apply
// any stored theme choice before first paint so a dark-mode visitor never
// flashes the light theme. Inline (not a module) and in `<head>` so it runs
// before the body renders, and a constant that builds no code from a value.
// The class and the stored theme (a `data-theme` attribute) differ from what
// the server rendered, so the root `<html>` carries `suppressHydrationWarning`
// (attribute-level, one element deep) to keep dev hydration checks quiet. The
// theme part's bare catch is deliberate and v3-byte-identical: localStorage
// access throws in some private-browsing modes, and the correct fallback is
// silently keeping the default prefers-color-scheme theme.
const THEME_BOOTSTRAP =
  '(function(){' +
  'document.documentElement.className=document.documentElement.className.replace("no-js","js");' +
  'try{var t=localStorage.getItem("bench-theme");if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t;}}catch(e){}' +
  '})();';

// This is a hack to load the web fonts without blocking page paint. The URL is
// written out here rather than interpolated from FONTS_CSS, so the inline
// script is a constant and never builds code from a value. lib/fonts.test.ts
// fails if the two drift apart.
const FONT_BOOTSTRAP =
  '(function(){var l=document.createElement("link");l.rel="stylesheet";' +
  'l.href="https://fonts.googleapis.com/css2?family=Funnel+Display:wght@400;500;600;700&family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500;600&display=swap";' +
  'document.head.appendChild(l);})();';

/**
 * Root layout: the `<html>`/`<body>` shell plus the global stylesheet, the
 * pre-paint theme bootstrap, and the web fonts.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="no-js" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <script dangerouslySetInnerHTML={{ __html: FONT_BOOTSTRAP }} />
        <noscript>
          <link rel="stylesheet" href={FONTS_CSS} />
        </noscript>
      </head>
      <body>{children}</body>
    </html>
  );
}
