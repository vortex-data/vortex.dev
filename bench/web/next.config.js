// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the file-tracing root to this app. The repo has multiple lockfiles
  // (workspace root, the v2 benchmarks-website project, and this app), so
  // Next.js cannot infer the correct root on its own.
  outputFileTracingRoot: __dirname,
  // Embed the checked-out commit in prebuilt output, independent of runtime settings.
  env: {
    VERCEL_GIT_COMMIT_SHA:
      process.env.BENCH_BUILD_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? 'unknown',
  },
};

module.exports = nextConfig;
