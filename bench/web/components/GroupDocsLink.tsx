// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

'use client';

/**
 * The "what does this measure?" link in a group's summary header, pointing at
 * the benchmark's explainer doc in the monorepo (see [`@/lib/benchmark-docs`]).
 * It is the long-form counterpart to the ⓘ tooltip's one-liner, and the same
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

/** An open-book glyph, matching the header icons' stroke style. */
function BookIcon() {
  return (
    <svg
      className="btn-icon"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 7a4 4 0 0 0-4-4H3v14h5a4 4 0 0 1 4 4" />
      <path d="M12 7a4 4 0 0 1 4-4h5v14h-5a4 4 0 0 0-4 4" />
      <path d="M12 7v14" />
    </svg>
  );
}
