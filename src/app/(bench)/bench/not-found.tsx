// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { BenchHeader } from '@/bench/components/BenchHeader';
import { NotFoundStatus } from '@/components/not-found';

/**
 * bench's 404, for the paths the catch-all route hands to `notFound()`: the
 * site's 404 body, in bench's layout under the shared header, with a 404
 * status. Its links point back to vortex.dev, because bench is served from its
 * own host.
 */
export default function BenchNotFound() {
  return (
    <>
      <BenchHeader />
      <main id="main" tabIndex={-1} className="bench-status">
        <NotFoundStatus origin="https://vortex.dev" />
      </main>
    </>
  );
}
