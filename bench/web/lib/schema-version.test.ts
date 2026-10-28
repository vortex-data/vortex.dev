// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { SCHEMA_VERSION } from './schema-version';

// Anchored declaration for the in-repo SCHEMA_VERSION lockstep site. The
// canonical contract lives in `CONTRACT.md`; this test reads the doc at test
// time and asserts its quoted anchor agrees with the TS `SCHEMA_VERSION`
// const, so drift between the doc and the code fails web-ci loudly instead of
// only surfacing at ingest. The cross-repo sites (the monorepo's
// `vortex-bench/src/v3.rs` and `scripts/post-ingest.py`) are documented in
// CONTRACT.md but cannot be verified from this repo.
const TS_DECL = /export const SCHEMA_VERSION = (\d+);/;

/**
 * Read an in-repo file (path relative to THIS test file) and extract the
 * integer SCHEMA_VERSION matched by `regex`. Throws — naming the file and
 * anchor — if the anchor is missing, so a renamed/moved anchor fails loudly
 * instead of silently passing.
 */
function versionFromFile(relPath: string, regex: RegExp, label: string): number {
  const source = readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), 'utf8');
  const match = source.match(regex);
  if (match === null) {
    throw new Error(
      `Could not find the SCHEMA_VERSION anchor in ${label} ` +
        `(expected to match ${String(regex)}). The anchor was likely renamed or ` +
        `moved — update this consistency check and CONTRACT.md together.`,
    );
  }
  return Number.parseInt(match[1], 10);
}

describe('SCHEMA_VERSION', () => {
  it('is pinned to the canonical value 3', () => {
    // Canary: a deliberate version bump must also update this line (and the
    // anchor below), so an accidental cross-anchor bump cannot pass silently.
    expect(SCHEMA_VERSION).toBe(3);
  });

  it('matches the anchor declaration documented in CONTRACT.md', () => {
    const docTsVersion = versionFromFile(
      '../../CONTRACT.md',
      TS_DECL,
      'CONTRACT.md (TS anchor row)',
    );
    // CONTRACT.md's anchor table quotes the declaration verbatim; it must
    // agree with the live TS const, so a doc that drifts from the code fails
    // here.
    expect(docTsVersion).toBe(SCHEMA_VERSION);
  });
});
