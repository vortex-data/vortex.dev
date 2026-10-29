// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

// The node environment: each test builds its own JSDOM, with scripts enabled,
// so the bootstrap runs while the page parses, as it does in a browser.

import { type DOMWindow, JSDOM, VirtualConsole } from 'jsdom';
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

function load(hash: string, beforeParse?: (window: DOMWindow) => void) {
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
    ...(beforeParse === undefined ? {} : { beforeParse }),
  });
  return { doc: dom.window.document, errors };
}

/** Count the script's calls to the DOM methods whose number could grow with
 * the fragment. jsdom's own parsing never goes through these wrappers. */
function countDomCalls(counts: { getAttribute: number; querySelector: number }) {
  return (window: DOMWindow): void => {
    const proto = window.Element.prototype;
    const { getAttribute, querySelector } = proto;
    proto.getAttribute = function (this: Element, name: string) {
      counts.getAttribute += 1;
      return getAttribute.call(this, name);
    };
    proto.querySelector = function (this: Element, selectors: string) {
      counts.querySelector += 1;
      return querySelector.call(this, selectors);
    } as typeof proto.querySelector;
  };
}

/** `count` distinct spellings of `word`, each character either as it is or
 * percent-encoded: every one decodes to `word`. */
function spellings(word: string, count: number): string[] {
  const out: string[] = [];
  for (let n = 0; out.length < count; n++) {
    let spelled = '';
    for (let i = 0; i < word.length; i++) {
      const ch = word.charAt(i);
      spelled += (n >> i) & 1 ? `%${ch.charCodeAt(0).toString(16)}` : ch;
    }
    out.push(spelled);
  }
  return out;
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
    '#__proto__',
    '#constructor,toString,clickbench',
    '#hasOwnProperty,__proto__,valueOf',
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

  // The DOM-call counts are the bound; the time limit only catches a stall.
  // Most of each case's time is jsdom parsing the megabyte URL, not the
  // script. Keep every case's URL distinct: jsdom can stall for over a minute
  // when it loads the same megabyte URL with scripts a second time.
  it.each([
    ['100k repeats of an unknown token', `#${'unknown,'.repeat(100_000)}clickbench`],
    ['100k repeats of an anchor', `#${'clickbench,'.repeat(100_000)}`],
    [
      '100k distinct unknown tokens',
      `#${Array.from({ length: 100_000 }, (_, i) => `x${i}`).join(',')},clickbench`,
    ],
    ['1k spellings of an anchor', `#${spellings('clickbench', 1_000).join(',')}`],
    ['30k spellings of an anchor', `#${spellings('tpc-h-nvme-sf-1', 30_000).join(',')},clickbench`],
  ])('stays linear in the fragment for %s', (_, hash) => {
    const counts = { getAttribute: 0, querySelector: 0 };
    const started = performance.now();
    const { doc, errors } = load(hash, countDomCalls(counts));
    const elapsed = performance.now() - started;
    // The helpers below call the same methods; count only the script's calls.
    const calls = { ...counts };

    const listed = resolveOpenAnchors(parseOpenFragment(hash), pageGroups(doc));
    expect(openAnchors(doc)).toEqual(
      pageGroups(doc)
        .map((g) => g.anchor)
        .filter((a) => listed.includes(a)),
    );
    expect(errors).toEqual([]);
    // One slug read per section to build the lookup, and at most one
    // disclosure lookup per section per way of naming it (anchor or slug).
    expect(calls.getAttribute).toBeLessThanOrEqual(SECTIONS.length);
    expect(calls.querySelector).toBeLessThanOrEqual(2 * SECTIONS.length);
    expect(elapsed).toBeLessThan(5_000);
  });
});
