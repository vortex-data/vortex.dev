// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

// The node environment: each test builds its own JSDOM, with scripts enabled,
// so the bootstrap runs while the page parses, as it does in a browser.

import { JSDOM, VirtualConsole } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { GroupSection } from '@/components/GroupSection';
import { OPEN_GROUPS_BOOTSTRAP, OpenGroupsScript } from '@/components/OpenGroupsScript';
import { groupAnchors } from '@/lib/anchor';
import type { FilterUniverse } from '@/lib/chart-format';
import { openAnchors, pageGroups, parseOpenFragment, resolveOpenAnchors } from '@/lib/open-groups';

const UNIVERSE: FilterUniverse = { engines: ['duckdb'], formats: ['parquet', 'vortex'] };
const NAMES = ['TPC-H (NVMe) (SF=1)', 'Random Access', 'Clickbench'];
const SLUGS = ['qm.tpch', 'random_access.eyJ', 'qm.click'];
const ANCHORS = groupAnchors(NAMES);

// Three real group sections, as the landing page renders them.
const SECTIONS = NAMES.map((name, i) => (
  <GroupSection
    key={SLUGS[i]}
    group={{ name, slug: SLUGS[i]!, charts: [{ name: 'q1', slug: `${SLUGS[i]}.q1` }] }}
    anchor={ANCHORS[i]!}
    startIndex={i}
    universe={UNIVERSE}
  />
));

function load(hash: string) {
  const html = renderToStaticMarkup(
    <main>
      <div id="group-nav-panel" />
      {SECTIONS}
      <OpenGroupsScript />
    </main>,
  );
  const virtualConsole = new VirtualConsole();
  const errors: unknown[] = [];
  virtualConsole.on('jsdomError', (e) => errors.push(e));
  const dom = new JSDOM(`<!DOCTYPE html><body>${html}</body>`, {
    url: `https://bench.vortex.dev/?engine=duckdb${hash}`,
    runScripts: 'dangerously',
    virtualConsole,
  });
  return { doc: dom.window.document, errors };
}

describe('OpenGroupsScript', () => {
  it('renders the constant bootstrap as it is', () => {
    expect(renderToStaticMarkup(<OpenGroupsScript />)).toBe(
      `<script data-role="open-groups-bootstrap">${OPEN_GROUPS_BOOTSTRAP}</script>`,
    );
  });

  it('is ES5 wrapped in a try, so no browser fails to parse it and no error escapes', () => {
    expect(OPEN_GROUPS_BOOTSTRAP).toMatch(/^\(function\(\)\{try\{.*\}catch\(e\)\{\}\}\)\(\);$/);
    expect(OPEN_GROUPS_BOOTSTRAP).not.toMatch(/=>|`|\blet\b|\bconst\b|\bclass\b/);
  });

  it('opens the listed groups while the page parses', () => {
    const { doc, errors } = load('#clickbench,tpc-h-nvme-sf-1');
    expect(pageGroups(doc)).toEqual([
      { anchor: 'tpc-h-nvme-sf-1', slug: 'qm.tpch' },
      { anchor: 'random-access', slug: 'random_access.eyJ' },
      { anchor: 'clickbench', slug: 'qm.click' },
    ]);
    expect(openAnchors(doc)).toEqual(['tpc-h-nvme-sf-1', 'clickbench']);
    expect(errors).toEqual([]);
  });

  it.each([
    '',
    '#',
    '#random-access',
    '#clickbench,tpc-h-nvme-sf-1',
    '#random-access,random-access',
    `#${encodeURIComponent('random_access.eyJ')}`,
    '#unknown',
    '#group-nav-panel',
    '#%E0%A4%A',
    '#%E0%A4%A,clickbench',
    '#,,clickbench,',
  ])('opens, while the page parses, exactly the groups the helpers resolve for "%s"', (hash) => {
    const { doc, errors } = load(hash);
    const listed = resolveOpenAnchors(parseOpenFragment(hash), pageGroups(doc));
    expect(openAnchors(doc)).toEqual(
      pageGroups(doc)
        .map((g) => g.anchor)
        .filter((a) => listed.includes(a)),
    );
    expect(errors).toEqual([]);
  });
});
