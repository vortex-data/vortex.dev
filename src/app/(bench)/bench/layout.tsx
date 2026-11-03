// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { BenchBaseProvider } from '@/bench/components/BenchBase';
import { benchPath } from '@/bench/lib/base-path';
import { requestBenchBase } from '@/bench/lib/request-base';
import { BENCH_DESCRIPTION, BENCH_URL, openGraph } from '@/bench/lib/site-files';
import { FONT_CLASSES } from '@/lib/fonts';

// The Vortex design system's colour roles and scales, which globals.css reads.
import '@/styles/vortex-tokens.css';
import '@/bench/styles/globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const base = await requestBenchBase();
  return {
    title: 'Vortex Benchmarks',
    description: BENCH_DESCRIPTION,
    // The canonical and Open Graph URLs are bench's public ones, written out
    // in full. No `metadataBase`: it would also resolve the icons' paths, which
    // belong to the host serving the page, against bench.vortex.dev.
    openGraph: openGraph('Vortex Benchmarks', BENCH_DESCRIPTION, `${BENCH_URL}/`),
    // Theme-aware favicons, ported from `render.rs::favicon_links`: the black
    // sigil on light-mode tabs, the white sigil on dark-mode tabs, with the dark
    // sigil as the unmediated fallback (and the apple-touch icon). The files are
    // in public/bench: the root of bench.vortex.dev.
    icons: {
      icon: [
        { url: benchPath(base, '/icon-light.png'), media: '(prefers-color-scheme: light)' },
        { url: benchPath(base, '/icon-dark.png'), media: '(prefers-color-scheme: dark)' },
        { url: benchPath(base, '/icon-dark.png') },
      ],
      apple: benchPath(base, '/icon-dark.png'),
    },
  };
}

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

/**
 * Root layout: the `<html>`/`<body>` shell plus the global stylesheet, the
 * pre-paint theme bootstrap, and the design system's faces, self-hosted as the
 * site's are (`lib/fonts.ts`). It also hands the client
 * components the base of bench's paths for the request's host
 * ([`BenchBaseProvider`], `lib/base-path.ts`).
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const base = await requestBenchBase();
  return (
    <html
      lang="en"
      data-theme="system"
      className={`no-js ${FONT_CLASSES}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>
        <BenchBaseProvider base={base}>{children}</BenchBaseProvider>
      </body>
    </html>
  );
}
