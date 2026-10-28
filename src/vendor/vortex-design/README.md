# Vortex design system modules

Copied unchanged from the Vortex design system's `components/lib/` on 2026-10-28. Do not edit
them here: change the system, then copy them again. Biome skips this folder.

| File | What it is |
| --- | --- |
| `ascii-mark.js` | The AsciiMark card's renderer: `mountAsciiMark(host, options)` |
| `ascii-core.js` | Its DOM-free rules: the luminance ramp, the brush and the hex flicker, and the LogoBanner's `copiesNeeded` |
| `vortex-mark-geometry.js` | The mark's mesh, generated from the 3D model |
| `benchmark-card.js` | The BenchmarkCard's DOM-free rules: `panelRows`, `versusParquet`, `formatFactor`, `panelNote` and `renderPanel` |

`ascii-mark.d.ts`, `ascii-core.d.ts`, `benchmark-card.d.ts` and `three.d.ts` are the site's own:
types for TypeScript, not part of the system. The site bundles three.js from npm (`three`,
pinned in `package.json`) and passes it as the `three` option, because its Content Security
Policy blocks the CDN copy the module loads by default.

The site draws the BenchmarkCard's panels in JSX from `benchmark-card.js`'s rules, and
`tests/unit/benchmark-card.test.tsx` checks that its markup equals `renderPanel`'s.
