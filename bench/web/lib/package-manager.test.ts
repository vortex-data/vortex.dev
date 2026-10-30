// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function readJson<T>(relative: string): T {
  return JSON.parse(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')) as T;
}

interface PackageJson {
  packageManager?: string;
}

interface RenovateRule {
  matchDepTypes?: string[];
  groupName?: string;
  additionalBranchPrefix?: string;
  commitMessageSuffix?: string;
}

const root = readJson<PackageJson>('../../../package.json');
const bench = readJson<PackageJson>('../package.json');
const renovate = readJson<{ packageRules: RenovateRule[] }>('../../../renovate.json');

// pnpm refuses to install in a project whose `packageManager` names another package manager, so
// the pin keeps a pnpm command in bench/web from installing around Bun's release-age cooldown.
describe('bench/web packageManager', () => {
  it('pins Bun, the same version as the root workspace', () => {
    expect(root.packageManager).toMatch(/^bun@\d+\.\d+\.\d+$/);
    expect(bench.packageManager).toBe(root.packageManager);
  });

  it('is updated with the root pin in one Renovate branch', () => {
    // Renovate's npm manager reads `packageManager` as depType `packageManager`. Without this rule
    // bench's copy would take the `bench-` branch prefix and land in a PR of its own.
    const benchRule = renovate.packageRules.findIndex(
      (rule) => rule.additionalBranchPrefix === 'bench-',
    );
    const pinRule = renovate.packageRules.findIndex((rule) =>
      rule.matchDepTypes?.includes('packageManager'),
    );
    expect(benchRule).toBeGreaterThanOrEqual(0);
    // Later rules win, so the pin's rule must come after bench's.
    expect(pinRule).toBeGreaterThan(benchRule);
    const rule = renovate.packageRules[pinRule]!;
    expect(rule.groupName).toBeTruthy();
    expect(rule.additionalBranchPrefix).toBe('');
    expect(rule.commitMessageSuffix).toBe('');
  });
});
