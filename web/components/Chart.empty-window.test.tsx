// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Chart } from '@/components/Chart';
import { resetGroup, resetPayloadCache, setShowEmptyCharts } from '@/lib/chart-store';

vi.mock('@/lib/chart-js', () => ({
  loadChartJs: () => new Promise(() => {}),
}));

// jsdom has no IntersectionObserver; the mount effect only needs a constructible
// stub here (no test in this file drives intersection-based hydration — the
// bundle fetch alone classifies and hides the empty cards).
class StubIO {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

const COMMITS = Array.from({ length: 3 }, (_, i) => ({
  sha: `sha${i}`,
  timestamp: `2026-01-01 00:00:0${i}+00`,
  message: `c${i}`,
  url: `https://example.invalid/sha${i}`,
}));
const HISTORY = { total_commits: 3, start_index: 0, loaded_commits: 3, complete: true };

/** A `/api/group/{slug}?n=100` bundle: `s0` empty in the window, `s1` live. */
function bundleResponse(): Response {
  const body = {
    name: 'g',
    charts: [
      // The empty-window wire shape: seeded commits, no recorded series.
      {
        name: 'q0',
        slug: 's0',
        display_name: 'q0',
        unit_kind: 'bytes',
        history: HISTORY,
        commits: COMMITS,
        series: {},
      },
      {
        name: 'q1',
        slug: 's1',
        display_name: 'q1',
        unit_kind: 'bytes',
        history: HISTORY,
        commits: COMMITS,
        series: { parquet: [1, 2, 3] },
      },
    ],
  };
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response;
}

describe('empty-window charts hide by default and the toggle reveals them', () => {
  let container: HTMLElement;
  let root: Root | null = null;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    resetPayloadCache();
    vi.stubGlobal('IntersectionObserver', StubIO);
    vi.stubGlobal('fetch', () => Promise.resolve(bundleResponse()));
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    root = null;
    container.remove();
    vi.unstubAllGlobals();
    resetPayloadCache();
  });

  /** Render islands `s0`/`s1` inside one OPEN group disclosure of `groupSlug`
   * and flush until the eager bundle fetch has settled and classified. */
  async function renderGroup(groupSlug: string): Promise<void> {
    container.innerHTML =
      '<section class="group-details">' +
      '<details class="group-disclosure" open><summary class="group-summary">g</summary></details>' +
      '<div class="chart-grid"><div id="m0"></div><div id="m1"></div></div>' +
      '</section>';
    const roots: Root[] = [];
    await act(async () => {
      for (let i = 0; i < 2; i++) {
        const r = createRoot(container.querySelector(`#m${i}`) as HTMLElement);
        roots.push(r);
        r.render(<Chart slug={`s${i}`} name={`q${i}`} index={i} groupSlug={groupSlug} />);
      }
    });
    root = {
      unmount: () => roots.forEach((r) => r.unmount()),
      render: () => {},
    } as unknown as Root;
    // Let the bundle fetch resolve, prime the cache, classify, and re-render.
    await act(async () => {
      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
      }
    });
  }

  function card(slug: string): HTMLElement {
    return container.querySelector(`[data-chart-slug="${slug}"]`) as HTMLElement;
  }

  it('hides only the card with no data in the latest-100 window', async () => {
    await renderGroup('empty-hide');
    expect(card('s0').hasAttribute('hidden')).toBe(true);
    expect(card('s1').hasAttribute('hidden')).toBe(false);
  });

  it('the toggle reveals the hidden card and Reset re-hides it', async () => {
    const groupSlug = 'empty-reveal';
    await renderGroup(groupSlug);
    expect(card('s0').hasAttribute('hidden')).toBe(true);

    await act(async () => {
      setShowEmptyCharts(groupSlug, true);
    });
    expect(card('s0').hasAttribute('hidden')).toBe(false);
    // The live sibling is unaffected by the toggle.
    expect(card('s1').hasAttribute('hidden')).toBe(false);

    await act(async () => {
      resetGroup(groupSlug);
    });
    expect(card('s0').hasAttribute('hidden')).toBe(true);
  });

  it('never hides a groupless (permalink-page) card', async () => {
    // The permalink island has no group slug: nothing classifies it and the
    // `hidden` gate never applies, even with an all-null payload.
    const r = createRoot(container);
    await act(async () => {
      r.render(<Chart slug="solo" name="solo" index={0} />);
    });
    root = r;
    expect((container.querySelector('[data-chart-slug="solo"]') as HTMLElement).hidden).toBe(false);
  });
});
