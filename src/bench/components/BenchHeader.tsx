// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { Toolbar, type ToolbarProps } from '@/bench/components/Toolbar';
import { benchPath } from '@/bench/lib/base-path';
import { requestBenchBase } from '@/bench/lib/request-base';
import { Header } from '@/components/layout/header';

/**
 * The site's header on a bench page, with bench's controls in its tools, then
 * the page's h1, "Benchmarks", for screen readers. The shared header carries
 * no title, so the h1 sits after it. A page with
 * its own h1, such as the 404, passes `heading={false}`. Each page renders it,
 * not the layout, because the filter dropdown takes the page's data. Its links
 * point back to vortex.dev, because bench is served from its own host.
 */
export async function BenchHeader({
  heading = true,
  ...props
}: ToolbarProps & { heading?: boolean }) {
  const base = await requestBenchBase();
  return (
    <>
      <Header bench={{ home: benchPath(base, '/') }} tools={<Toolbar {...props} />} />
      {heading && <h1 className="vx-sr-only">Benchmarks</h1>}
    </>
  );
}
