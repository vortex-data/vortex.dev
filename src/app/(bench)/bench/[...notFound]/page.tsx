// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { notFound } from 'next/navigation';

/**
 * Every bench URL no other bench route matches. The app has two root layouts,
 * and an unmatched URL gets the marketing site's 404 (src/app/global-not-found.tsx).
 * This route keeps bench's 404 in bench's layout, as it was when bench was an
 * app of its own.
 */
export default function UnmatchedBenchPath(): never {
  notFound();
}
