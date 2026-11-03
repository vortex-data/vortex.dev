// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

'use client';

import { useBenchPath } from '@/bench/components/BenchBase';

/** The footer's link to the methodology page, at this host's base of bench's paths. */
export function MethodologyLink() {
  const path = useBenchPath();
  return (
    <a className="site-footer-link" href={path('/methodology')}>
      Methodology
    </a>
  );
}
