// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

// @vitest-environment node

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./globals.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/** The body of the first `@supports (anchor-name: …)` block. */
const anchored = (() => {
  const start = css.search(/@supports\s*\(\s*anchor-name:/);
  if (start < 0) return null;
  let depth = 0;
  const open = css.indexOf('{', start);
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  return null;
})();

/** The declarations of the rule whose selector is exactly `selector`, inside `source`. */
function rule(source: string, selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return source.match(new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? null;
}

// A group's info tooltip hangs from the icon. The icon sits after the group name, often near the
// right edge of a phone, so a tooltip that only grows rightwards from it ran past the card, which
// clips it. Where the browser has anchor positioning, the tooltip takes the summary row as its
// containing block and finds the icon by anchor: it starts at the icon but moves left as far as
// the row's padding when it would not fit, and never ends past the padding on the right.
describe("a group's info tooltip", () => {
  it('keeps the row padding in one variable, at every width', () => {
    const paddings = [...css.matchAll(/\.group-summary-row\s*\{([^}]*)\}/g)]
      .map((m) => m[1]?.match(/padding:\s*([^;]+)/)?.[1]?.trim())
      .filter(Boolean);
    expect(paddings.length).toBeGreaterThan(0);
    for (const padding of paddings) expect(padding).toMatch(/var\(--group-pad-x\)$/);
  });

  it('finds the icon by anchor, from the summary row', () => {
    expect(anchored).not.toBeNull();
    const body = anchored ?? '';
    expect(rule(body, '.group-summary-row')).toMatch(/position:\s*relative/);
    const icon = rule(body, '.group-info-icon') ?? '';
    expect(icon).toMatch(/position:\s*static/);
    expect(icon).toMatch(/anchor-name:\s*--group-info/);
  });

  it('hangs below the icon and stays inside the row padding on both sides', () => {
    const tip = rule(anchored ?? '', '[data-tooltip].group-info-icon::after') ?? '';
    expect(tip).toMatch(/top:\s*calc\(anchor\(--group-info bottom\)\s*\+\s*0\.5rem\)/);
    expect(tip).toMatch(/left:\s*clamp\(\s*var\(--group-pad-x\),\s*anchor\(--group-info left\),/);
    expect(tip).toMatch(/right:\s*var\(--group-pad-x\)/);
    expect(tip).toMatch(/width:\s*fit-content/);
  });
});
