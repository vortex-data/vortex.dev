// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { ThemeToggle } from '@/bench/components/ThemeToggle';
import { Toolbar, type ToolbarProps } from '@/bench/components/Toolbar';
import { benchPath } from '@/bench/lib/base-path';
import { requestBenchBase } from '@/bench/lib/request-base';
import { Header } from '@/components/layout/header';

/**
 * The site's header on a bench page, with bench's controls and theme toggle on
 * its row. Each page renders it, not the layout, because the filter dropdown
 * takes the page's data. Its links point back to vortex.dev, because bench is
 * served from its own host.
 */
export async function BenchHeader(props: ToolbarProps) {
  const base = await requestBenchBase();
  return (
    <Header
      bench={{ home: benchPath(base, '/') }}
      tools={<Toolbar {...props} />}
      theme={<ThemeToggle />}
      themeRow={<ThemeToggle row />}
    />
  );
}
