// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

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

// The pre-paint theme bootstrap, ported verbatim from
// `render.rs::theme_bootstrap_script`: apply any stored theme choice before
// first paint so a dark-mode visitor never flashes the light theme. Inline (not
// a module) and in `<head>` so it runs before the body renders. The stored
// theme lands as a `data-theme` attribute the server never rendered, so the
// root `<html>` carries `suppressHydrationWarning` (attribute-level, one
// element deep) to keep dev hydration checks quiet for themed visitors. The
// script's bare catch is deliberate and v3-byte-identical: localStorage
// access throws in some private-browsing modes, and the correct fallback is
// silently keeping the default prefers-color-scheme theme.
const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem("bench-theme");if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t;}}catch(e){}})();`;

const FUNNEL_DISPLAY_CSS =
  'https://fonts.googleapis.com/css2?family=Funnel+Display:wght@400;500;600;700&display=swap';

// This is a hack to load Funnel font without blocking page paint
const FONT_BOOTSTRAP = `(function(){var l=document.createElement("link");l.rel="stylesheet";l.href=${JSON.stringify(FUNNEL_DISPLAY_CSS)};document.head.appendChild(l);})();`;

/**
 * Root layout: the `<html>`/`<body>` shell plus the global stylesheet, the
 * pre-paint theme bootstrap, and the heading web font.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <script dangerouslySetInnerHTML={{ __html: FONT_BOOTSTRAP }} />
        <noscript>
          <link rel="stylesheet" href={FUNNEL_DISPLAY_CSS} />
        </noscript>
      </head>
      <body>{children}</body>
    </html>
  );
}
