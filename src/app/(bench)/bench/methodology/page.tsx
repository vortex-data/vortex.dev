// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import type { Metadata } from 'next';

import { Footer } from '@/bench/components/Footer';
import { BenchHeader } from '@/bench/components/BenchHeader';
import { METHODOLOGY } from '@/bench/lib/methodology';
import { BENCH_URL, openGraph } from '@/bench/lib/site-files';

const TITLE = 'Methodology - Vortex Benchmarks';
const DESCRIPTION =
  'How the Vortex benchmarks run: the machines, storage, engines, and formats, how each ' +
  'result is measured, and how the summaries are scored.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${BENCH_URL}/methodology` },
  openGraph: openGraph(TITLE, DESCRIPTION, `${BENCH_URL}/methodology`),
};

/**
 * `/methodology`: how the results are produced and scored, from
 * `lib/methodology.ts`, which `llms.txt` prints too. It reads no data, so it
 * renders the same for every request.
 */
export default function MethodologyPage() {
  return (
    <>
      <BenchHeader />
      <main>
        <article className="methodology">
          <h2>Methodology</h2>
          <p>
            Results for <a href="https://vortex.dev">Vortex</a> and the formats it is compared with,
            measured by the benchmarks in{' '}
            <a href="https://github.com/vortex-data/vortex">vortex-data/vortex</a>. The summary of
            every benchmark group is also in <a href={`${BENCH_URL}/llms.txt`}>llms.txt</a> as text.
          </p>
          {METHODOLOGY.map((section) => (
            <section key={section.title}>
              <h3>{section.title}</h3>
              {section.text.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </section>
          ))}
        </article>
      </main>
      <Footer />
    </>
  );
}
