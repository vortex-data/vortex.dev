// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { describe, expect, it } from 'vitest';

import { benchBaseForHost, benchPath } from '@/bench/lib/base-path';

describe('benchBaseForHost', () => {
  it('serves bench from the root on its own host, whatever the port or case', () => {
    expect(benchBaseForHost('bench.vortex.dev')).toBe('');
    expect(benchBaseForHost('bench.vortex.dev:443')).toBe('');
    expect(benchBaseForHost('Bench.Vortex.Dev')).toBe('');
  });

  it('serves bench under /bench everywhere else', () => {
    for (const host of [
      'vortex.dev',
      'localhost:3000',
      '127.0.0.1:3102',
      'vortex-git-branch-vortex-data.vercel.app',
      'bench.vortex.dev.example.com',
      '',
      null,
      undefined,
    ]) {
      expect(benchBaseForHost(host), String(host)).toBe('/bench');
    }
  });
});

describe('benchPath', () => {
  it('leaves paths alone on bench.vortex.dev', () => {
    for (const path of ['/', '/#tpc-h', '/?engine=duckdb', '/chart/qm.x', '/api/group/g?n=100']) {
      expect(benchPath('', path)).toBe(path);
    }
  });

  it('prefixes paths with /bench elsewhere, the landing page being /bench itself', () => {
    expect(benchPath('/bench', '/')).toBe('/bench');
    expect(benchPath('/bench', '/#tpc-h,clickbench')).toBe('/bench#tpc-h,clickbench');
    expect(benchPath('/bench', '/?engine=duckdb')).toBe('/bench?engine=duckdb');
    expect(benchPath('/bench', '/chart/qm.x')).toBe('/bench/chart/qm.x');
    expect(benchPath('/bench', '/api/chart/qm.x?n=100')).toBe('/bench/api/chart/qm.x?n=100');
    expect(benchPath('/bench', '/icon-dark.png')).toBe('/bench/icon-dark.png');
  });

  it('refuses a path that is not root-relative', () => {
    expect(() => benchPath('/bench', 'chart/x')).toThrow(/root-relative/);
    expect(() => benchPath('', 'https://bench.vortex.dev/')).toThrow(/root-relative/);
  });
});
