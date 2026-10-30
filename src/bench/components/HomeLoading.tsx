// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { Footer } from '@/components/Footer';
import { Header } from '@/components/Header';

/**
 * The landing page's loading view, streamed at once when its data is slow to
 * read (see `app/page.tsx`); the groups replace it when the read finishes.
 * Without JavaScript nothing replaces it, so a `<noscript>` line says to
 * reload. Not soon: the CDN keeps `/` for five minutes (`vercel.json`), so a
 * reload within them replays this same copy.
 */
export function HomeLoading() {
  return (
    <>
      <Header />
      <main className="summary-loading" aria-busy="true">
        <div className="summary-loading-panel" role="status" aria-live="polite">
          <span className="chart-spinner summary-loading-spinner" aria-hidden="true" />
          <h2>Loading benchmark summaries…</h2>
          <p>This can take a few seconds after new results are published.</p>
          <noscript>
            <p>Without JavaScript this page cannot finish loading. Reload it in a few minutes.</p>
          </noscript>
        </div>
      </main>
      <Footer />
    </>
  );
}
