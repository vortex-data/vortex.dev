// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

/**
 * Client-side singletons shared by the chart islands, the stateful counterpart
 * to the pure helpers in `lib/chart-format.ts`: the bounded-concurrency fetch
 * queues, the global engine/format filter store, and the per-group filter/Y
 * stores. One instance of each lives per browser tab (module scope), mirroring
 * the page-level closures of `server/static/chart-init.js`.
 *
 * The stores expose a `subscribe`/`getSnapshot` pair compatible with React's
 * `useSyncExternalStore`, so the islands (every `Chart`, the global
 * `FilterBar`, each `GroupToolbar`) re-render and re-apply filters when any of
 * them mutates shared state. Snapshots are replaced wholesale on mutation;
 * a stable reference means "nothing changed".
 *
 * This module holds browser-tab state and is only imported from `'use client'`
 * components; it has no DOM dependency itself, so node-environment vitest can
 * exercise the queues and stores directly.
 */

export * from './queues';
export * from './bundles';
export * from './global-filter';
export * from './group-store';
