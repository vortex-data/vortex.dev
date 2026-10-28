// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import path from 'node:path';

import { defineConfig } from '@playwright/test';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set; bench/scripts/parity/run.sh sets it`);
  }
  return value;
}

const out = requiredEnv('PARITY_OUT');

/**
 * Pixel comparison of the pages of one bench server. `run.sh` runs it twice: once against the base
 * server with `--update-snapshots=all` to write the baselines, then against the head server to
 * compare with them. `maxDiffPixels: 0` and `threshold: 0` allow no differing pixel, except that
 * Playwright's comparator (pixelmatch, with `includeAA` left false) ignores pixels it classes as
 * anti-aliasing. That fits a bar of no human-perceptible difference, and a layout shift of 1px or
 * more still fails.
 */
export default defineConfig({
  testDir: '.',
  testMatch: 'screenshots.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['line'], ['json']],
  // A failed comparison leaves its expected, actual and diff images here.
  outputDir: path.join(out, 'results'),
  snapshotDir: path.join(out, 'snapshots'),
  snapshotPathTemplate: '{snapshotDir}/{projectName}/{arg}{ext}',
  expect: { toHaveScreenshot: { maxDiffPixels: 0, threshold: 0 } },
  use: {
    baseURL: requiredEnv('BASE_URL'),
    browserName: 'chromium',
    colorScheme: 'light',
    deviceScaleFactor: 1,
    locale: 'en-US',
    reducedMotion: 'reduce',
    timezoneId: 'UTC',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    {
      name: 'phone',
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
});
