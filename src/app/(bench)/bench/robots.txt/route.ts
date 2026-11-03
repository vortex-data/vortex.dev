// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { READ_API_CACHE_CONTROL } from '@/bench/lib/cache';
import { robotsText } from '@/bench/lib/site-files';

/**
 * `GET /robots.txt` on bench.vortex.dev (`/bench/robots.txt` elsewhere): open
 * to every crawler, and naming the sitemap. The app's own `robots.ts` answers
 * on vortex.dev; `next.config.mjs` rewrites this host's path here first.
 * bench's layout makes its routes dynamic, so the CDN keeps the answer.
 */
export function GET(): Response {
  return new Response(robotsText(), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': READ_API_CACHE_CONTROL,
    },
  });
}
