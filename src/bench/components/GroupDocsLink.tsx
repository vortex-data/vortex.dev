// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

'use client';

import { BookIcon } from '@/components/icons';

/**
 * The "what does this measure?" link in a group's summary header, pointing at
 * the benchmark's explainer doc in the monorepo (see [`@/lib/benchmark-docs`]).
 * It is the long-form counterpart to the info tooltip's one-liner, and the same
 * doc the monorepo's PR benchmark comment links.
 *
 * The link lives inside the disclosure's `<summary>`, where any click that
 * reaches the summary toggles the group open or closed. `stopPropagation`
 * keeps the click from reaching it, so opening the docs never collapses the
 * group; the anchor's own default action (navigation) is left intact.
 */
export function GroupDocsLink({ href, groupName }: { href: string; groupName: string }) {
  return (
    <a
      className="group-docs-link"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`View a detailed description of the ${groupName} benchmark on GitHub`}
      aria-label={`View a detailed description of the ${groupName} benchmark on GitHub`}
      onClick={(e) => {
        e.stopPropagation();
      }}
    >
      <BookIcon />
    </a>
  );
}
