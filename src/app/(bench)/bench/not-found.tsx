// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import type { Metadata } from 'next';

import { BenchHeader } from '@/bench/components/BenchHeader';
import { NOT_FOUND_METADATA } from '@/bench/lib/not-found-metadata';
import { NotFoundStatus } from '@/components/not-found';

export const metadata: Metadata = NOT_FOUND_METADATA;

/**
 * bench's 404, for the paths the catch-all route hands to `notFound()`: the
 * site's 404 body, in bench's layout under the shared header, with a 404
 * status. The 404's code is the page's one h1, so the header leaves out its
 * own. Its links point back to vortex.dev, because bench is served from its
 * own host.
 */
export default function BenchNotFound() {
  return (
    <>
      <BenchHeader heading={false} />
      <main id="main" tabIndex={-1} className="bench-status">
        <NotFoundStatus origin="https://vortex.dev" />
      </main>
    </>
  );
}
