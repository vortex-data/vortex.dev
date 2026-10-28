// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

/**
 * Human-readable URL anchors for the landing page's group sections.
 *
 * Group permalinks (`/#tpc-h-nvme-sf-1`) use these anchors, NOT the opaque
 * API slugs from [`./slug`]: a fragment only has to match a section `id` on
 * the page, so it never needs the slug's machine-decodable base64 payload,
 * and the display name — stable and unique per page — makes a far friendlier
 * URL. The API keeps the opaque slug.
 */

/**
 * Derive a URL anchor from a group display name: lowercase, every run of
 * non-alphanumerics collapsed to a single `-`, leading/trailing dashes
 * trimmed. `TPC-H (NVMe) (SF=1)` becomes `tpc-h-nvme-sf-1`. A name with no
 * alphanumerics at all falls back to `group` so the anchor is never empty.
 */
export function groupAnchor(name: string): string {
  const anchor = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return anchor === '' ? 'group' : anchor;
}

/**
 * Anchor every group name on a page, de-duplicating collisions with `-2`,
 * `-3`, … suffixes in encounter order. Names are unique today, but two names
 * differing only in punctuation would slugify identically; suffixing keeps
 * every section `id` (and thus every permalink) unambiguous rather than
 * silently landing on the first collision.
 */
export function groupAnchors(names: readonly string[]): string[] {
  const seen = new Set<string>();
  return names.map((name) => {
    const base = groupAnchor(name);
    let anchor = base;
    for (let i = 2; seen.has(anchor); i++) {
      anchor = `${base}-${i}`;
    }
    seen.add(anchor);
    return anchor;
  });
}
