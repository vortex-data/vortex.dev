// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

// This config is CommonJS, so it loads modules with require().
const path = require('node:path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Trace from the repository root. This app is a member of the root Bun
  // workspace, whose packages live in the root node_modules, so a trace that
  // starts here would leave them out of the deployed functions.
  outputFileTracingRoot: path.join(__dirname, '../..'),
  // Embed the checked-out commit in prebuilt output, independent of runtime settings.
  env: {
    VERCEL_GIT_COMMIT_SHA:
      process.env.BENCH_BUILD_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? 'unknown',
  },
};

module.exports = nextConfig;
