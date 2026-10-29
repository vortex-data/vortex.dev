// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

// @vitest-environment node

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, 'globals.css'), 'utf8');

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(source: string, selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return source.match(new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? null;
}

describe('the stylesheet without JavaScript', () => {
  it('hides every control that needs JavaScript under the no-js root, beating their own display rules', () => {
    expect(rule(css, '.no-js [data-requires-js]')).toMatch(/display:\s*none\s*!important/);
  });

  it('hides a collapsed group body, which sits after its <details>, not inside it', () => {
    expect(rule(css, '.group-disclosure:not([open]) ~ .group-body')).toMatch(/display:\s*none/);
  });

  it('shows the mobile nav in the header row, since no script can open its panel', () => {
    const mobile = css.match(/@media\s*\(max-width:\s*768px\)\s*\{(?:[^{}]|\{[^{}]*\})*\}/g);
    expect(mobile).not.toBeNull();
    const declarations = rule(mobile!.join('\n'), '.no-js .nav-controls');
    expect(declarations).toMatch(/display:\s*flex/);
    expect(declarations).toMatch(/position:\s*static/);
  });
});
