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

const root = readJson<PackageJson>('../../../package.json');
const bench = readJson<PackageJson>('../package.json');

// pnpm refuses to install in a project whose `packageManager` names another package manager, so
// the pin keeps a pnpm command in bench/web from installing around Bun's release-age cooldown.
describe('bench/web packageManager', () => {
  it('pins Bun, the same version as the root workspace', () => {
    expect(root.packageManager).toMatch(/^bun@\d+\.\d+\.\d+$/);
    expect(bench.packageManager).toBe(root.packageManager);
  });
});
