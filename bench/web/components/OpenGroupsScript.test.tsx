// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

// The node environment: each test builds its own JSDOM, with scripts enabled,
// so the bootstrap runs while the page parses, as it does in a browser.

import { type DOMWindow, JSDOM, VirtualConsole } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { GroupSection } from '@/components/GroupSection';
import {
  OPEN_GROUPS_BOOTSTRAP,
  OPEN_GROUPS_FINISH,
  OpenGroupsScript,
} from '@/components/OpenGroupsScript';
import { groupAnchors } from '@/lib/anchor';
import type { FilterUniverse } from '@/lib/chart-format';
import {
  openAnchors,
  pageGroups,
  parseOpenFragment,
  resolveOpenAnchors,
  takeOpenGroupsBootstrap,
} from '@/lib/open-groups';
import { USER_INPUT } from '@/lib/scroll-restore';

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
      <OpenGroupsScript>{SECTIONS}</OpenGroupsScript>
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
  return { window: dom.window, doc: dom.window.document, errors };
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
  it('renders the constant scripts as they are, before the first group and after the last', () => {
    expect(
      renderToStaticMarkup(
        <OpenGroupsScript>
          <section id="g" />
        </OpenGroupsScript>,
      ),
    ).toBe(
      `<script data-role="open-groups-bootstrap">${OPEN_GROUPS_BOOTSTRAP}</script>` +
        '<section id="g"></section>' +
        `<script data-role="open-groups-finish">${OPEN_GROUPS_FINISH}</script>`,
    );
  });

  it.each([
    ['bootstrap', OPEN_GROUPS_BOOTSTRAP],
    ['finish step', OPEN_GROUPS_FINISH],
  ])(
    'keeps the %s ES5 wrapped in a try, so no browser fails to parse it and no error escapes',
    (_, script) => {
      expect(script).toMatch(/^\(function\(\)\{try\{.*\}catch\(e\)\{\}\}\)\(\);$/);
      expect(script).not.toMatch(/=>|`|\blet\b|\bconst\b|\bclass\b/);
    },
  );

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

  // The DOM-call counts are the bound. Most of each case's time is jsdom
  // parsing the megabyte URL, not the script. Keep every case's URL distinct:
  // jsdom can stall for over a minute when it loads the same megabyte URL with
  // scripts a second time.
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
    const { doc, errors } = load(hash, countDomCalls(counts));
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
  });

  // `LandingState` takes this marker on its first mount: it keeps what the
  // reader opened or closed before hydration, and skips a restore the reader
  // has already overridden by scrolling.
  describe('the marker it leaves for LandingState', () => {
    it('marks its document, with no input yet', () => {
      const { doc, errors } = load('#clickbench');
      expect(takeOpenGroupsBootstrap(doc)).toEqual({ input: false });
      expect(takeOpenGroupsBootstrap(doc)).toBeNull();
      expect(errors).toEqual([]);
    });

    it.each(USER_INPUT)('records %s before hydration as input', (type) => {
      const { window, doc } = load('#clickbench');
      doc.querySelector('summary')?.dispatchEvent(new window.Event(type, { bubbles: true }));
      expect(takeOpenGroupsBootstrap(doc)).toEqual({ input: true });
    });

    it('does not record a scroll, such as the jump to a single-anchor fragment, as input', () => {
      const { window, doc } = load('#random-access');
      window.dispatchEvent(new window.Event('scroll'));
      doc.dispatchEvent(new window.Event('scroll'));
      expect(takeOpenGroupsBootstrap(doc)).toEqual({ input: false });
    });

    it('stops listening once taken', () => {
      const { window, doc } = load('');
      const marker = (doc as unknown as Record<string, { input: boolean }>).__benchOpenGroups;
      expect(takeOpenGroupsBootstrap(doc)).toEqual({ input: false });

      for (const type of USER_INPUT) {
        window.dispatchEvent(new window.Event(type));
      }
      expect(marker?.input).toBe(false);
    });

    it('leaves no marker when it fails, so the groups open after hydration instead', () => {
      const { doc, errors } = load('#clickbench', (window) => {
        window.Document.prototype.querySelectorAll = () => {
          throw new Error('boom');
        };
      });
      expect(takeOpenGroupsBootstrap(doc)).toBeNull();
      expect(errors).toEqual([]);
    });
  });

  // On a slow connection the browser paints the first groups before the rest
  // have arrived, so each listed group must open as soon as it is parsed. The
  // observer runs at the end of the parser task that inserted the group,
  // before the browser can paint it; `settle` lets it run.
  describe('while the page is still arriving', () => {
    const SECTION_HTML = SECTIONS.map((section) => renderToStaticMarkup(section));

    /** A page whose `<main>` holds only the bootstrap, as a browser has it
     * before the first group arrives. `append` adds markup to the end of
     * `<main>`, as the parser does, and `finish` runs the finish step. */
    function stream(hash: string) {
      const virtualConsole = new VirtualConsole();
      const errors: unknown[] = [];
      virtualConsole.on('jsdomError', (e) => errors.push(e));
      const dom = new JSDOM(
        `<!DOCTYPE html><body><main><script>${OPEN_GROUPS_BOOTSTRAP}</script></main></body>`,
        { url: `https://bench.vortex.dev/${hash}`, runScripts: 'dangerously', virtualConsole },
      );
      const doc = dom.window.document;
      const main = doc.querySelector('main');
      if (main === null) {
        throw new Error('no main');
      }
      return {
        window: dom.window,
        doc,
        main,
        errors,
        append: (html: string) => main.insertAdjacentHTML('beforeend', html),
        settle: () => new Promise((resolve) => setTimeout(resolve, 0)),
        finish: () => {
          const script = doc.createElement('script');
          script.textContent = OPEN_GROUPS_FINISH;
          main.appendChild(script);
        },
      };
    }

    it('opens a listed group as soon as it is parsed, before the later groups arrive', async () => {
      const page = stream('#random-access');
      page.append(SECTION_HTML[0]!);
      await page.settle();
      expect(openAnchors(page.doc)).toEqual([]);

      page.append(SECTION_HTML[1]!);
      await page.settle();
      expect(openAnchors(page.doc)).toEqual(['random-access']);
      // The marker waits for the finish step.
      expect((page.doc as unknown as Record<string, unknown>).__benchOpenGroups).toBeUndefined();

      page.append(SECTION_HTML[2]!);
      page.finish();
      expect(openAnchors(page.doc)).toEqual(['random-access']);
      expect(takeOpenGroupsBootstrap(page.doc)).toEqual({ input: false });
      expect(page.errors).toEqual([]);
    });

    it('opens a listed group whose disclosure arrives after its section', async () => {
      const page = stream('#random-access');
      const section = page.doc.createElement('section');
      section.id = 'random-access';
      section.setAttribute('data-group-slug', 'random_access.eyJ');
      page.main.appendChild(section);
      await page.settle();

      const details = page.doc.createElement('details');
      details.className = 'group-disclosure';
      section.appendChild(details);
      await page.settle();
      expect(details.open).toBe(true);
    });

    it('keeps closed a listed group the reader closed before the last group arrived', async () => {
      const page = stream('#tpc-h-nvme-sf-1,clickbench');
      page.append(SECTION_HTML[0]!);
      await page.settle();
      expect(openAnchors(page.doc)).toEqual(['tpc-h-nvme-sf-1']);

      const first = page.doc.querySelector<HTMLDetailsElement>('details.group-disclosure');
      if (first === null) {
        throw new Error('no disclosure');
      }
      first.open = false;
      page.append(SECTION_HTML[1]! + SECTION_HTML[2]!);
      await page.settle();
      page.finish();
      expect(openAnchors(page.doc)).toEqual(['clickbench']);
    });

    it('opens a group the fragment lists by its slug only at the end, when no group can still claim it as an anchor', async () => {
      const page = stream(`#${encodeURIComponent('random_access.eyJ')}`);
      for (const html of SECTION_HTML) {
        page.append(html);
        await page.settle();
      }
      expect(openAnchors(page.doc)).toEqual([]);

      page.finish();
      expect(openAnchors(page.doc)).toEqual(['random-access']);
    });

    it('records input from before the last group arrived', () => {
      const page = stream('#clickbench');
      page.append(SECTION_HTML[0]!);
      page.window.dispatchEvent(new page.window.Event('keydown'));
      page.append(SECTION_HTML[1]! + SECTION_HTML[2]!);
      page.finish();
      expect(takeOpenGroupsBootstrap(page.doc)).toEqual({ input: true });
    });
  });
});
