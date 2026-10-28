// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { Footer } from '@/components/Footer';
import { Header } from '@/components/Header';

/** The streamed landing-page shell shown while group summaries load. */
export function HomeLoading() {
  return (
    <>
      <Header />
      <main className="summary-loading" aria-busy="true">
        <div className="summary-loading-panel" role="status" aria-live="polite">
          <span className="chart-spinner summary-loading-spinner" aria-hidden="true" />
          <h2>Loading benchmark summaries…</h2>
          <p>This can take a few seconds after new results are published.</p>
        </div>
      </main>
      <Footer />
    </>
  );
}
