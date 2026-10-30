# Vortex design system modules

Copied unchanged from the Vortex design system's `components/lib/`: `ascii-mark.js`,
`ascii-core.js`, `benchmark-card.js`, `benchmark-card.d.ts`, `theme.js`, `callout.js`,
`code-block.js` and their `.d.ts` files on 2026-10-29, `cover.js` and `cover.d.ts` on 2026-10-30, the rest on 2026-10-28. Do not edit them here: change the
system, then copy them again. Biome skips this folder.

| File | What it is |
| --- | --- |
| `ascii-mark.js` | The AsciiMark card's renderer: `mountAsciiMark(host, options)`, in Dark or Light |
| `ascii-core.js` | Its DOM-free rules: the luminance ramp, the brush, the hex flicker, each theme's palette (`markPalette`) and the readback (`frameReader`), and the LogoBanner's `copiesNeeded` |
| `vortex-mark-geometry.js` | The mark's mesh, generated from the 3D model |
| `benchmark-card.js` | The BenchmarkCard's DOM-free rules: `formatScore`, `exactValue`, `pickSystems`, `panelRows`, `valueWidth`, `versusParquet`, `formatFactor`, `panelFactor`, `panelNote`, `barClass` and `renderPanel` |
| `benchmark-card.d.ts` | Its types, which the system ships beside it |
| `theme.js` | The ThemeSwitch's rules: the first-paint script for the blog's paths (`themeBootstrap`), `isThemeable`, `themeFor`, `readChoice` and `saveChoice` |
| `callout.js` | The Callout card's Markdown rule: `calloutOf` turns a GitHub alert or an emoji-led blockquote into an aside |
| `code-block.js` | The CodeBlock card's Shiki theme (`shikiTheme`) and labels (`codeLabel`) |
| `cover.js` | The Cover card's generator: `coverFor(seed, opts)`, the SVG a post's slug draws, and `coverLayout`, the same parts as data for the Open Graph image |
| `theme.d.ts`, `callout.d.ts`, `code-block.d.ts`, `cover.d.ts` | Their types, which the system ships beside them |

`ascii-mark.d.ts`, `ascii-core.d.ts` and `three.d.ts` are the site's own: types for TypeScript,
not part of the system. The site bundles three.js from npm (`three`,
pinned in `package.json`) and passes it as the `three` option, because its Content Security
Policy blocks the CDN copy the module loads by default.

The site draws the BenchmarkCard's panels in JSX from `benchmark-card.js`'s rules, and
`tests/unit/benchmark-card.test.tsx` checks that its markup equals `renderPanel`'s.
