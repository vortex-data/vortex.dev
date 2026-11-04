// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

// @vitest-environment jsdom

// Where focus goes when one of bench's disclosure panels closes: the jump
// menu (GroupNav), the global filters (FilterBar), and a group's series filter
// (GroupToolbar). The WAI-ARIA disclosure pattern returns focus to the trigger
// when Escape closes a panel that holds it, so focus never stays on a control
// that is now hidden.

import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FilterBar } from '@/bench/components/FilterBar';
import { GroupNav } from '@/bench/components/GroupNav';
import { GroupToolbar } from '@/bench/components/GroupToolbar';
import { resetUrlWrites } from '@/bench/lib/url-writes';
import { defined } from '@/lib/defined';

const UNIVERSE = { engines: ['datafusion', 'duckdb'], formats: ['parquet', 'vortex'] };

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  resetUrlWrites(window);
  // jsdom does not implement scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  resetUrlWrites(window);
  window.history.replaceState(null, '', '/');
});

function mount(element: ReactElement): void {
  root = createRoot(container);
  act(() => {
    root?.render(element);
  });
}

function click(el: HTMLElement): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function pressEscape(): void {
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
  });
}

const cases: {
  name: string;
  render: () => ReactElement;
  trigger: string;
  panelControl: string;
}[] = [
  {
    name: 'GroupNav',
    render: () => (
      <GroupNav
        groups={[
          { name: 'Random Access', slug: 'random_access.abc' },
          { name: 'ClickBench', slug: 'clickbench' },
        ]}
      />
    ),
    trigger: '.group-nav-toggle',
    panelControl: '.group-nav-link',
  },
  {
    name: 'FilterBar',
    render: () => <FilterBar universe={UNIVERSE} initialEngines={null} initialFormats={null} />,
    trigger: '[data-role="filter-trigger"]',
    panelControl: '[data-role="filter-panel"] button',
  },
  {
    name: 'GroupToolbar',
    render: () => <GroupToolbar groupSlug="random_access" universe={UNIVERSE} />,
    trigger: '[data-role="group-filter-trigger"]',
    panelControl: '[data-role="group-filter-panel"] button',
  },
];

describe.each(cases)('$name: Escape', ({ render, trigger, panelControl }) => {
  it('closes the panel and returns focus to its trigger', () => {
    mount(render());
    const toggle = defined(container.querySelector<HTMLButtonElement>(trigger));
    toggle.focus();
    click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    defined(container.querySelector<HTMLButtonElement>(panelControl)).focus();

    pressEscape();

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
  });

  it('leaves focus alone when it has already left the panel', () => {
    const elsewhere = document.createElement('button');
    document.body.appendChild(elsewhere);
    mount(render());
    const toggle = defined(container.querySelector<HTMLButtonElement>(trigger));
    click(toggle);
    elsewhere.focus();

    pressEscape();

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(elsewhere);
  });
});

describe('GroupNav: a jump', () => {
  function seed(): void {
    const section = document.createElement('section');
    section.id = 'random-access';
    section.dataset.groupSlug = 'random_access.abc';
    section.innerHTML =
      '<details class="group-disclosure"><summary class="group-summary">Random Access</summary></details>';
    document.body.appendChild(section);
  }

  function jump(name: string): HTMLButtonElement {
    const toggle = defined(container.querySelector<HTMLButtonElement>('.group-nav-toggle'));
    click(toggle);
    const entry = defined(
      Array.from(container.querySelectorAll<HTMLButtonElement>('.group-nav-link')).find(
        (b) => b.textContent === name,
      ),
    );
    entry.focus();
    click(entry);
    return toggle;
  }

  it('moves focus to the summary of the group it opened', () => {
    seed();
    mount(<GroupNav groups={[{ name: 'Random Access', slug: 'random_access.abc' }]} />);

    jump('Random Access');

    expect(document.activeElement).toBe(document.querySelector('#random-access summary'));
  });

  it('returns focus to the trigger when the group is not on the page', () => {
    mount(<GroupNav groups={[{ name: 'Missing', slug: 'missing' }]} />);

    const toggle = jump('Missing');

    expect(document.activeElement).toBe(toggle);
  });
});
