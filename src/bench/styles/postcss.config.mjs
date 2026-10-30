// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import modernBrowsers from 'next/dist/shared/lib/modern-browserslist-target.js';

// bench's stylesheets only: with no PostCSS config at the repository root,
// Turbopack uses the config in a CSS file's own directory, and the marketing
// site's CSS keeps Turbopack's defaults. These are
// the plugins Next.js's webpack build applies when it finds no config at all
// (see getDefaultPlugins in next/dist/build/webpack/config/blocks/css/plugins.js),
// so the CSS keeps the transforms bench's builds had before Next.js 16 made
// Turbopack the default.
const config = {
  plugins: [
    'next/dist/compiled/postcss-flexbugs-fixes',
    [
      'next/dist/compiled/postcss-preset-env',
      {
        browsers: modernBrowsers,
        autoprefixer: { flexbox: 'no-2009' },
        stage: 3,
        features: { 'custom-properties': false },
      },
    ],
  ],
};

export default config;
