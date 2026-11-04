// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import type { Metadata } from 'next';

import { BenchHeader } from '@/bench/components/BenchHeader';
import { DarkOnly } from '@/components/dark-only';
import { NotFoundStatus } from '@/components/not-found';

const TITLE = 'Page not found | Vortex';
const SENTENCE = 'There is no page at this address.';

// The site's 404 metadata (src/app/(site)/not-found.tsx). The Open Graph
// object replaces the layout's, so the page has no og:url: a missing page is
// not bench's home.
export const metadata: Metadata = {
  title: TITLE,
  description: SENTENCE,
  openGraph: { title: TITLE, description: SENTENCE, siteName: 'Vortex', type: 'website' },
};

/**
 * bench's 404, for the paths the catch-all route hands to `notFound()`: the
 * site's 404 body, in bench's layout under the shared header, with a 404
 * status. Its links point back to vortex.dev, because bench is served from its
 * own host. It is Dark whatever the theme, as the site's is: `DarkOnly` comes
 * first, so the header paints Dark too.
 */
export default function BenchNotFound() {
  return (
    <>
      <DarkOnly />
      <BenchHeader />
      <main id="main" tabIndex={-1} className="bench-status">
        <NotFoundStatus origin="https://vortex.dev" />
      </main>
    </>
  );
}
