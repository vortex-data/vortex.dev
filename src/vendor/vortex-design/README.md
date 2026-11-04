# Vortex design system modules

Copied unchanged from the Vortex design system's `components/lib/`: `ascii-mark.js`,
`ascii-core.js`, `results.js`, `theme.js`, `callout.js`, `code-block.js`, `cover.js`, the
`.d.ts` file the system ships beside each, and `vortex-mark-geometry.js`. Do not edit them here: change the
system, then copy them again. Biome skips this folder.

`SHA256SUMS` lists the hash of each file copied from the system, and
`tests/unit/styles.test.ts` fails if a file no longer matches it, so a hand edit
shows up in CI. After copying, run
`shasum -a 256 $(awk '{print $2}' SHA256SUMS) > SHA256SUMS` in this folder, and
list a newly copied file there first. `three.d.ts` is the site's own, so it is not listed.

| File | What it is |
| --- | --- |
| `ascii-mark.js` | The AsciiMark card's renderer: `mountAsciiMark(host, options)`, in Dark or Light |
| `ascii-core.js` | Its DOM-free rules: the luminance ramp, the brush, the hex flicker, each theme's palette (`markPalette`) and the readback (`frameReader`), and the LogoBanner's `copiesNeeded` |
| `vortex-mark-geometry.js` | The mark's mesh, generated from the 3D model |
| `results.js` | The ResultsTable's DOM-free rules: `formatScore`, `exactValue`, `pickSystems`, `panelRows`, `valueWidth`, `versusParquet`, `formatFactor`, `panelFactor`, `panelNote`, `panelVerdict`, `resultsSystems`, `resultsRow` and `renderResults`, and a Figure's bars (`barClass`, `renderBars`) |
| `results.d.ts` | Its types, which the system ships beside it |
| `theme.js` | The ThemeSwitch's rules: the first-paint script for the blog's paths (`themeBootstrap`), `isThemeable`, `themeFor`, `readChoice`, and `saveChoice`, and `mountThemeSwitch`, which the site does not call (`src/lib/theme.ts` draws the switch in React) |
| `callout.js` | The Callout card's Markdown rule: `calloutOf` turns a GitHub alert or an emoji-led blockquote into an aside |
| `code-block.js` | The CodeBlock card's Shiki theme (`shikiTheme`) and labels (`codeLabel`) |
| `cover.js` | The Cover card's generator: `coverFor(seed, opts)`, the SVG a post's slug draws, and `coverLayout`, the same parts as data for the Open Graph image |
| `ascii-mark.d.ts`, `ascii-core.d.ts`, `theme.d.ts`, `callout.d.ts`, `code-block.d.ts`, `cover.d.ts` | Their types, which the system ships beside them |

`three.d.ts` is the site's own: types for TypeScript, not part of the system. The site bundles three.js from npm (`three`,
pinned in `package.json`) and passes it as the `three` option, because its Content Security
Policy blocks the CDN copy the module loads by default.

The site draws the homepage's ResultsTable in JSX (`src/components/results-table`) from
`results.js`'s rules, and `tests/unit/results-table.test.tsx` checks its markup against
`renderResults`'.
