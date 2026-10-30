// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { Header } from '@/components/Header';

describe('Header and the no-js class', () => {
  let root: Root | null = null;
  const host = document.createElement('div');

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    host.remove();
    document.documentElement.className = '';
  });

  it('swaps for js a no-js class that React put back on the root', () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    document.documentElement.className = 'no-js';
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root?.render(<Header />);
    });
    expect(document.documentElement.className).toBe('js');
  });
});
