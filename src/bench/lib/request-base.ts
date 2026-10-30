// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { headers } from 'next/headers';

import { type BenchBase, benchBaseForHost } from '@/bench/lib/base-path';

/**
 * The base of bench's paths for the request being rendered, from its `Host`
 * header (see `lib/base-path.ts`). Server components only. Every bench page is
 * rendered per request already, so reading the header costs no caching.
 */
export async function requestBenchBase(): Promise<BenchBase> {
  return benchBaseForHost((await headers()).get('host'));
}
