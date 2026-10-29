// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GroupNav, jumpToGroup, type GroupNavItem } from '@/components/GroupNav';

const GROUPS: GroupNavItem[] = [
  { name: 'Random Access', slug: 'random_access.abc' },
  { name: 'PolarSignals Profiling', slug: 'qmg.polar' },
];

describe('GroupNav markup', () => {
  it('renders a closed toggle and a link per group', () => {
    const html = renderToStaticMarkup(<GroupNav groups={GROUPS} />);
    expect(html).toContain('aria-label="Jump to group"');
    expect(html).toContain('aria-controls="group-nav-panel"');
    // Closed by default: the toggle reports collapsed and the panel lacks --open.
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('group-nav-panel--open');
    expect(html).toContain('id="group-nav-panel"');
    expect(html).toContain('>Random Access</button>');
    expect(html).toContain('>PolarSignals Profiling</button>');
  });

  it('renders nothing when there are no groups', () => {
    expect(renderToStaticMarkup(<GroupNav groups={[]} />)).toBe('');
  });
});

describe('jumpToGroup', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function seedSections(): void {
    document.body.innerHTML = `
      <div id="group-nav-panel"></div>
      <section id="polarsignals-profiling" data-group-slug="qmg.polar">
        <details class="group-disclosure"><summary>PolarSignals</summary></details>
      </section>
      <section id="random-access" data-group-slug="random_access.abc">
        <details class="group-disclosure"><summary>Random Access</summary></details>
      </section>`;
  }

  it('opens the target group disclosure and scrolls it into view', () => {
    seedSections();
    // jsdom does not implement scrollIntoView; stub it so the call is observable.
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;

    const found = jumpToGroup('random_access.abc', document);

    expect(found).toBe(true);
    const target = document.querySelector<HTMLElement>('[data-group-slug="random_access.abc"]');
    const disclosure = target?.querySelector<HTMLDetailsElement>('details.group-disclosure');
    expect(disclosure?.open).toBe(true);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    // The other group's disclosure stays closed.
    const other = document
      .querySelector('[data-group-slug="qmg.polar"]')
      ?.querySelector<HTMLDetailsElement>('details.group-disclosure');
    expect(other?.open).toBe(false);
  });

  it('returns false for an unknown slug and does not scroll', () => {
    seedSections();
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;

    expect(jumpToGroup('does-not-exist', document)).toBe(false);
    expect(scrollSpy).not.toHaveBeenCalled();
  });
});

describe('GroupNav jump-menu clicks', () => {
  let container: HTMLElement;
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container.remove();
    document.body.innerHTML = '';
    window.history.replaceState(null, '', '/');
  });

  it('opens the group, adds it to the fragment, and closes the panel', () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = `
      <section id="random-access" data-group-slug="random_access.abc">
        <details class="group-disclosure"><summary>Random Access</summary></details>
      </section>`;
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(<GroupNav groups={GROUPS} />);
    });

    const toggle = container.querySelector<HTMLButtonElement>('.group-nav-toggle');
    act(() => {
      toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(container.querySelector('.group-nav-panel--open')).not.toBeNull();

    const link = Array.from(container.querySelectorAll<HTMLButtonElement>('.group-nav-link')).find(
      (b) => b.textContent === 'Random Access',
    );
    act(() => {
      link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(window.location.hash).toBe('#random-access');
    const disclosure = document
      .querySelector('#random-access')
      ?.querySelector<HTMLDetailsElement>('details.group-disclosure');
    expect(disclosure?.open).toBe(true);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.group-nav-panel--open')).toBeNull();
  });

  it('adds the group to the fragment after groups already open, in page order', () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = `
      <section id="polarsignals-profiling" data-group-slug="qmg.polar">
        <details class="group-disclosure" open><summary>PolarSignals</summary></details>
      </section>
      <section id="random-access" data-group-slug="random_access.abc">
        <details class="group-disclosure"><summary>Random Access</summary></details>
      </section>`;
    Element.prototype.scrollIntoView = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(<GroupNav groups={GROUPS} />);
    });

    const link = Array.from(container.querySelectorAll<HTMLButtonElement>('.group-nav-link')).find(
      (b) => b.textContent === 'Random Access',
    );
    act(() => {
      link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(window.location.hash).toBe('#polarsignals-profiling,random-access');
  });

  it('does not touch the URL when the jump target is missing', () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    // No sections seeded: every jump misses.
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(<GroupNav groups={GROUPS} />);
    });

    const link = container.querySelector<HTMLButtonElement>('.group-nav-link');
    act(() => {
      link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(window.location.hash).toBe('');
  });
});
