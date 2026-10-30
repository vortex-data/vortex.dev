// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

'use client';

import { createContext, type ReactNode, useCallback, useContext } from 'react';

import { type BenchBase, benchPath } from '@/bench/lib/base-path';

/**
 * The base of bench's paths for the page being rendered (see
 * `lib/base-path.ts`). The root layout provides it from the request's host,
 * so the server render and the client's hydration agree. Without a provider
 * (a component test) it is bench's own host, the root.
 */
const BenchBaseContext = createContext<BenchBase>('');

/** Provide the base of bench's paths to the client components below. */
export function BenchBaseProvider({ base, children }: { base: BenchBase; children: ReactNode }) {
  return <BenchBaseContext.Provider value={base}>{children}</BenchBaseContext.Provider>;
}

/** The base of bench's paths for this page. */
export function useBenchBase(): BenchBase {
  return useContext(BenchBaseContext);
}

/** [`benchPath`] bound to this page's base. */
export function useBenchPath(): (path: string) => string {
  const base = useBenchBase();
  return useCallback((path: string) => benchPath(base, path), [base]);
}
