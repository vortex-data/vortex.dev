// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { BenchBaseProvider } from '@/bench/components/BenchBase';
import { benchPath } from '@/bench/lib/base-path';
import { requestBenchBase } from '@/bench/lib/request-base';
import { BENCH_DESCRIPTION, BENCH_URL, openGraph } from '@/bench/lib/site-files';
import { Footer } from '@/components/layout/footer';
import { RouteTheme } from '@/components/route-theme';
import { FONT_CLASSES } from '@/lib/fonts';
import { BENCH_THEME_BOOTSTRAP } from '@/lib/theme';

// The Vortex design system's colour roles and scales, which globals.css reads,
// and its components, for the site's header and footer.
import '@/styles/vortex-tokens.css';
import '@/styles/vortex.css';
import '@/bench/styles/globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const base = await requestBenchBase();
  return {
    title: 'Benchmarks | Vortex',
    description: BENCH_DESCRIPTION,
    // The canonical and Open Graph URLs are bench's public ones, written out
    // in full. No `metadataBase`: it would also resolve the icons' paths, which
    // belong to the host serving the page, against bench.vortex.dev.
    openGraph: openGraph('Benchmarks | Vortex', BENCH_DESCRIPTION, `${BENCH_URL}/`),
    // The site's favicon (one set on every
    // surface), copied into public/bench, the root of bench.vortex.dev.
    icons: {
      icon: { url: benchPath(base, '/favicon.ico'), sizes: '256x256', type: 'image/x-icon' },
    },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

// The pre-paint bootstrap, the site's (`lib/theme.ts`): its first statement
// swaps the root's server-rendered `no-js` class for `js`, so `.no-js
// [data-requires-js]` (globals.css) hides the controls that do nothing without
// JavaScript only when no script runs. The rest sets the reader's theme from
// the `vx-theme` cookie that vortex.dev's subdomains share (else storage, else
// Dark) before first paint. The class and the theme differ from what the
// server rendered, so the root `<html>` carries `suppressHydrationWarning`.
/**
 * Root layout: the `<html>`/`<body>` shell plus the global stylesheet, the
 * pre-paint theme bootstrap, and the design system's faces, self-hosted as the
 * site's are (`lib/fonts.ts`). It also hands the client
 * components the base of bench's paths for the request's host
 * ([`BenchBaseProvider`], `lib/base-path.ts`). Every page renders the site's
 * header with bench's controls on its row ([`BenchHeader`]) and sits above
 * the site's footer, whose links point back to vortex.dev, because bench is
 * served from its own host.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const base = await requestBenchBase();
  return (
    <html lang="en" data-theme="dark" className={`no-js ${FONT_CLASSES}`} suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a constant script that sets the theme before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: BENCH_THEME_BOOTSTRAP }} />
      </head>
      <body>
        <RouteTheme />
        {/* The first tab stop. Each page's <main> has the id and takes focus
            (tabIndex -1). A fragment-only href works on either base. */}
        <a className="vx-skip-link" href="#main">
          Skip to content
        </a>
        <BenchBaseProvider base={base}>
          <div className="bench-frame">
            {children}
            <Footer origin="https://vortex.dev" />
          </div>
        </BenchBaseProvider>
      </body>
    </html>
  );
}
