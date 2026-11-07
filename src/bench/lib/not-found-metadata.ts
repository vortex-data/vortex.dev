// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import type { Metadata } from 'next';

const TITLE = 'Page not found | Vortex';
const SENTENCE = 'There is no page at this address.';

/**
 * bench's 404 metadata, the site's (src/app/(site)/not-found.tsx). The Open
 * Graph object replaces the layout's, so the page has no og:url: a missing
 * page is not bench's home.
 *
 * not-found.tsx exports it, and so does every route that calls `notFound()`.
 * The server renders not-found.tsx's metadata, but after hydration the client
 * sets the route's own, so a route without it showed the layout's title,
 * "Benchmarks | Vortex", on its 404.
 */
export const NOT_FOUND_METADATA: Metadata = {
  title: TITLE,
  description: SENTENCE,
  openGraph: { title: TITLE, description: SENTENCE, siteName: 'Vortex', type: 'website' },
};
