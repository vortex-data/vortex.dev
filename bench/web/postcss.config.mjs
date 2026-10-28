// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import modernBrowsers from 'next/dist/shared/lib/modern-browserslist-target.js';

// Next.js looks for a PostCSS config here and then in every parent directory,
// so without this file the build would load the marketing site's Tailwind
// config from the repository root (Turbopack reads this file too). These are
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
