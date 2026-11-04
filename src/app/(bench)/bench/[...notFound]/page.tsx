// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { notFound } from 'next/navigation';

/**
 * Every bench URL no other bench route matches. The app has two root layouts,
 * and an unmatched URL gets the marketing site's 404 (src/app/global-not-found.tsx).
 * This route keeps bench's unmatched paths out of the site's 404. bench has no
 * not-found.tsx, so Next.js answers with its default 404 document: it carries
 * bench's metadata, but not bench's layout, header, or `lang`.
 */
export default function UnmatchedBenchPath(): never {
  notFound();
}
