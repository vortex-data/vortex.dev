// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

/**
 * The `SCHEMA_VERSION` source of truth. See `CONTRACT.md` at the repo root for
 * the full emitter→ingest contract; the consistency check in
 * `schema-version.test.ts` asserts the anchor quoted there agrees with this
 * constant.
 *
 * This constant must stay equal to the cross-repo sites in the
 * `vortex-data/vortex` monorepo in one coordinated change (documented in
 * `CONTRACT.md`, not testable from this repo):
 *
 * - `vortex-bench/src/v3.rs` — producer wire-shape source of truth.
 * - `scripts/post-ingest.py` (`SCHEMA_VERSION`) — CI ingest writer literal.
 *
 * The read service surfaces it on `/health` so an operator can detect schema
 * skew between the served data and the producers.
 */
export const SCHEMA_VERSION = 3;
