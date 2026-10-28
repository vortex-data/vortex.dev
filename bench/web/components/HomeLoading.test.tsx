// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { HomeLoading } from '@/components/HomeLoading';

describe('HomeLoading', () => {
  it('renders an accessible summary-loading state', () => {
    const html = renderToStaticMarkup(<HomeLoading />);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain('Loading benchmark summaries…');
    expect(html).toContain('summary-loading-spinner');
  });
});
