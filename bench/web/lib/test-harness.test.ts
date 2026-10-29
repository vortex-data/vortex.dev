// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { describe, expect, it } from 'vitest';
import { integrationDatabaseAvailable, testDatabaseSettings } from './test-harness';

describe('testDatabaseSettings', () => {
  it('reads host, port, user and admin database, with a placeholder password', () => {
    expect(testDatabaseSettings('postgres://postgres@127.0.0.1:55433/postgres')).toEqual({
      host: '127.0.0.1',
      port: 55433,
      user: 'postgres',
      password: 'trust',
      adminDatabase: 'postgres',
    });
  });

  it('decodes the password and defaults the port and admin database', () => {
    expect(testDatabaseSettings('postgresql://will:p%40ss@localhost')).toEqual({
      host: 'localhost',
      port: 5432,
      user: 'will',
      password: 'p@ss',
      adminDatabase: 'postgres',
    });
  });

  it.each(['mysql://u@h/db', 'postgres://h/db'])('rejects %s', (url) => {
    expect(() => testDatabaseSettings(url)).toThrow('BENCH_TEST_DATABASE_URL');
  });
});

describe('integrationDatabaseAvailable', () => {
  it('prefers BENCH_TEST_DATABASE_URL, then Docker', () => {
    expect(
      integrationDatabaseAvailable({ BENCH_TEST_DATABASE_URL: 'postgres://u@h/db' }, () => false),
    ).toBe(true);
    expect(integrationDatabaseAvailable({}, () => true)).toBe(true);
    expect(integrationDatabaseAvailable({}, () => false)).toBe(false);
  });

  it('fails loudly in CI when no database is available', () => {
    expect(() => integrationDatabaseAvailable({ CI: 'true' }, () => false)).toThrow(
      'BENCH_TEST_DATABASE_URL',
    );
  });
});
