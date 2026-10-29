// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { HomeLoading } from '@/components/HomeLoading';

describe('HomeLoading', () => {
  const html = renderToStaticMarkup(<HomeLoading />);

  it('renders an accessible summary-loading state', () => {
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain('Loading benchmark summaries…');
    expect(html).toContain('summary-loading-spinner');
  });

  it('tells a reader without JavaScript to reload, since nothing will replace it', () => {
    expect(html).toContain(
      '<noscript><p>Without JavaScript this page cannot finish loading. Reload it in a few minutes.</p></noscript>',
    );
  });
});
