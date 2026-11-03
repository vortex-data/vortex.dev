// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { READ_API_CACHE_CONTROL } from '@/bench/lib/cache';
import { cachedGroups } from '@/bench/lib/data-cache';
import { llmsText } from '@/bench/lib/site-files';

// Rendered per request from the Data Cache, like `/api/groups`, so `next build`
// needs no database; the CDN keeps it for five minutes.
export const dynamic = 'force-dynamic';

/**
 * `GET /llms.txt` (https://llmstxt.org): every group's results in words, with
 * the methodology, for language models. Markdown, served as plain text.
 */
export async function GET(): Promise<Response> {
  return new Response(llmsText(await cachedGroups(), new Date()), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': READ_API_CACHE_CONTROL,
    },
  });
}
