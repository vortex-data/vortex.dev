// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GroupBody, type GroupBodyProps } from '@/components/GroupBody';
import { GroupSection } from '@/components/GroupSection';
import {
  OPEN_GROUPS_BOOTSTRAP,
  OPEN_GROUPS_FINISH,
  OpenGroupsScript,
} from '@/components/OpenGroupsScript';
import {
  abortGroupBundle,
  bundleQueue,
  getGroupSnapshot,
  initGroupFilter,
  resetPayloadCache,
  toggleGroupSeries,
} from '@/lib/chart-store';
import { groupBodiesReady, resetGroupBodies } from '@/lib/group-bodies';
import { takeOpenGroupsBootstrap } from '@/lib/open-groups';
import type { Group } from '@/lib/queries';

// The real island is covered by the `Chart.*` suites; here a bare card stands
// in for it, so the body's own mount, fetch and abort behavior is all that runs.
vi.mock('@/components/Chart', async () => {
  const { createElement } = await import('react');
  return {
    Chart: ({ slug, index }: { slug: string; index: number }) =>
      createElement('section', {
        className: 'chart-card',
        'data-chart-slug': slug,
        'data-chart-index': index,
      }),
  };
});

const PROPS: GroupBodyProps = {
  groupSlug: 'g',
  charts: [
    { name: 'q1', slug: 'c1' },
    { name: 'q2', slug: 'c2' },
  ],
  startIndex: 5,
  universe: { engines: ['datafusion', 'duckdb'], formats: ['parquet', 'vortex'] },
  initialHiddenSeries: ['duckdb:parquet'],
  initialShownSeries: [],
};

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response;
}

/** Let every pending promise chain and queued task run. */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('GroupBody', () => {
  let container: HTMLElement;
  let body: HTMLElement;
  let root: Root | null = null;
  let urls: string[];
  let signals: (AbortSignal | undefined)[];
  let responders: ((r: Response) => void)[];

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    resetPayloadCache();
    resetGroupBodies();
    initGroupFilter('g', [], []);
    urls = [];
    signals = [];
    responders = [];
    // Group requests never resolve unless a test resolves them; an abort
    // rejects them, as a real fetch does, so the bundle queue's slot frees.
    vi.stubGlobal('fetch', (url: string | URL, init?: RequestInit) => {
      urls.push(String(url));
      signals.push(init?.signal ?? undefined);
      return new Promise<Response>((resolve, reject) => {
        responders.push(resolve);
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    });
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    abortGroupBundle('g');
    await act(async () => {
      root?.unmount();
    });
    root = null;
    await flush();
    container.remove();
    vi.unstubAllGlobals();
    resetPayloadCache();
    window.history.replaceState(null, '', '/');
  });

  async function render(open = false, props: Partial<GroupBodyProps> = {}): Promise<void> {
    container.innerHTML =
      '<section class="group-details" data-group-slug="g">' +
      `<details class="group-disclosure"${open ? ' open' : ''}><summary>g</summary></details>` +
      '<div id="body"></div>' +
      '</section>';
    body = container.querySelector('#body') as HTMLElement;
    root = createRoot(body);
    await act(async () => {
      root?.render(<GroupBody {...PROPS} {...props} />);
    });
  }

  /** Open or close the group the way the existing suites do. */
  async function toggle(open: boolean): Promise<void> {
    const details = container.querySelector('details.group-disclosure') as HTMLDetailsElement;
    await act(async () => {
      details.open = open;
      details.dispatchEvent(new Event('toggle'));
    });
  }

  it('renders an empty body while collapsed', () => {
    expect(renderToStaticMarkup(<GroupBody {...PROPS} />)).toBe('<div class="group-body"></div>');
  });

  it('mounts the toolbar and one card per chart, with page-wide indices, when the group opens', async () => {
    await render();
    expect(body.querySelector('[data-role="group-toolbar"]')).toBeNull();
    expect(body.querySelectorAll('.chart-card')).toHaveLength(0);

    await toggle(true);
    expect(body.querySelector('[data-role="group-toolbar"]')).not.toBeNull();
    expect(
      [...body.querySelectorAll<HTMLElement>('.chart-card')].map((c) => c.dataset.chartIndex),
    ).toEqual(['5', '6']);
  });

  it('mounts at once when the group is already open at hydration', async () => {
    await render(true);
    expect(body.querySelectorAll('.chart-card')).toHaveLength(2);
  });

  it('hydrates server markup that the pre-paint script opened, with no hydration warning', async () => {
    const group: Group = { name: 'G', slug: 'g', charts: PROPS.charts };
    const page = (
      <main>
        <OpenGroupsScript>
          <GroupSection
            group={group}
            anchor="g-anchor"
            startIndex={PROPS.startIndex}
            universe={PROPS.universe}
          />
        </OpenGroupsScript>
      </main>
    );
    container.innerHTML = renderToString(page);
    window.history.replaceState(null, '', '/#g-anchor');
    // Markup set through innerHTML never runs its scripts, so run the
    // bootstrap and its finish step here, as the parser would have before
    // hydration.
    for (const code of [OPEN_GROUPS_BOOTSTRAP, OPEN_GROUPS_FINISH]) {
      const script = document.createElement('script');
      script.textContent = code;
      document.body.appendChild(script);
      script.remove();
    }
    // No `LandingState` here to take the script's marker; drop it.
    takeOpenGroupsBootstrap(document);
    const details = container.querySelector<HTMLDetailsElement>('details.group-disclosure');
    expect(details?.hasAttribute('open')).toBe(true);
    expect(container.querySelectorAll('.chart-card')).toHaveLength(0);

    const consoleError = vi.spyOn(console, 'error');
    const recoverableError = vi.fn();
    await act(async () => {
      root = hydrateRoot(container, page, { onRecoverableError: recoverableError });
    });
    await flush();

    // The body opened during hydration and fetched its bundle once.
    expect(container.querySelectorAll('.chart-card')).toHaveLength(2);
    expect(urls).toEqual(['/api/group/g?n=100']);
    // `open` is the only difference from the server markup, and the
    // disclosure's `suppressHydrationWarning` covers it.
    expect(recoverableError).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("requests the group bundle once, at its first chart's priority", async () => {
    const schedule = vi.spyOn(bundleQueue, 'schedule');
    await render();
    await flush();
    expect(urls).toEqual([]);

    await toggle(true);
    await flush();
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule.mock.calls[0]?.[1]).toBe(-5);
    expect(urls).toEqual(['/api/group/g?n=100']);
  });

  it('closing unmounts the body and aborts the bundle, even when no chart island hears the toggle', async () => {
    await render();
    await toggle(true);
    await flush();
    expect(body.querySelectorAll('.chart-card')).toHaveLength(2);
    expect(signals[0]?.aborted).toBe(false);

    await toggle(false);
    expect(body.querySelectorAll('.chart-card')).toHaveLength(0);
    expect(body.querySelector('[data-role="group-toolbar"]')).toBeNull();
    expect(signals[0]?.aborted).toBe(true);
  });

  it('reopening after a successful bundle fetches nothing', async () => {
    await render();
    await toggle(true);
    await flush();
    expect(urls).toHaveLength(1);
    responders[0]?.(jsonResponse({ name: 'g', charts: [] }));
    await flush();

    await toggle(false);
    await toggle(true);
    await flush();
    expect(body.querySelectorAll('.chart-card')).toHaveLength(2);
    expect(urls).toHaveLength(1);
  });

  // The once-per-page-load guard itself is pinned in `lib/group-bodies.test.ts`;
  // here the body stays mounted across the close, so its seed never reruns.
  it("seeds the URL's series overrides, and keeps the user's later change across a close and reopen", async () => {
    await render();
    await toggle(true);
    expect(getGroupSnapshot('g').hiddenSeries).toEqual(['duckdb:parquet']);

    toggleGroupSeries('g', 'duckdb:parquet');
    await toggle(false);
    await toggle(true);
    await flush();
    expect(getGroupSnapshot('g').hiddenSeries).toEqual([]);
  });

  it('tells the scroll restorer when its body has mounted and its bundle has settled', async () => {
    const ready = groupBodiesReady(['g']);
    const fired: string[] = [];
    void ready.mounted.then(() => fired.push('mounted'));
    void ready.settled.then(() => fired.push('settled'));
    await render();
    await flush();
    expect(fired).toEqual([]);

    await toggle(true);
    await flush();
    await expect(ready.mounted).resolves.toBeUndefined();
    expect(fired).toEqual(['mounted']);

    responders[0]?.(jsonResponse({ name: 'g', charts: [] }));
    await flush();
    expect(fired).toEqual(['mounted', 'settled']);
  });

  it('fetches nothing for a group with no charts, and tells the scroll restorer at once', async () => {
    const ready = groupBodiesReady(['g']);
    const fired: string[] = [];
    void ready.mounted.then(() => fired.push('mounted'));
    void ready.settled.then(() => fired.push('settled'));
    await render(false, { charts: [] });
    await toggle(true);
    await flush();

    expect(body.querySelector('[data-role="group-toolbar"]')).not.toBeNull();
    expect(urls).toEqual([]);
    expect(fired).toEqual(['mounted', 'settled']);
  });

  it('after a close, makes the scroll restorer wait for the reopened body', async () => {
    await render();
    await toggle(true);
    await flush();
    await toggle(false);
    await flush();

    const ready = groupBodiesReady(['g']);
    const fired: string[] = [];
    void ready.mounted.then(() => fired.push('mounted'));
    await flush();
    expect(fired).toEqual([]);

    await toggle(true);
    await flush();
    expect(body.querySelectorAll('.chart-card')).toHaveLength(2);
    expect(fired).toEqual(['mounted']);
  });

  it('after an unmount, makes the scroll restorer wait for a new body', async () => {
    await render(true);
    await flush();
    await act(async () => {
      root?.unmount();
    });
    root = null;

    const ready = groupBodiesReady(['g']);
    const fired: string[] = [];
    void ready.mounted.then(() => fired.push('mounted'));
    await flush();
    expect(fired).toEqual([]);

    await render(true);
    await flush();
    expect(fired).toEqual(['mounted']);
  });
});
