// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { READ_API_CACHE_CONTROL } from '@/bench/lib/cache';
import { cachedGroups } from '@/bench/lib/data-cache';
import { sitemapXml } from '@/bench/lib/site-files';

// Rendered per request from the Data Cache, like `/api/groups`, so `next build`
// needs no database; the CDN keeps it for five minutes.
export const dynamic = 'force-dynamic';

/** `GET /sitemap.xml`: the landing page, the methodology page and every chart page. */
export async function GET(): Promise<Response> {
  return new Response(sitemapXml(await cachedGroups()), {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': READ_API_CACHE_CONTROL,
    },
  });
}
