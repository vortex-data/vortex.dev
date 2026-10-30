import { formatDay } from "./date";

/** "26 Feb 2026": a post's date in the BlogIndex and Article cards. */
export function formatPostDate(iso: string): string {
  return formatDay(new Date(iso));
}

/** The Article card's mono byline, which joins these with middle dots. */
export function bylineParts(post: {
  date: string;
  authors: readonly string[];
  metadata: { readingTime: number };
}): [string, string, string] {
  const minutes = Math.max(1, post.metadata.readingTime);
  return [
    formatPostDate(post.date),
    post.authors.join(", "),
    `${minutes} min read`
  ];
}

/**
 * The Article card's ending: the nearest older and newer posts by date, or
 * null at either end. Pass the site's own posts only: a post on another site
 * is never a neighbour.
 */
export function adjacentPosts<T extends { slugAsParams: string; date: string }>(
  posts: readonly T[],
  slug: string
): { older: T | null; newer: T | null } {
  // Newest first. The sort is stable, so two posts of one day keep the
  // order they came in, and each is the other's neighbour.
  const byDate = [...posts].sort(
    (a, b) => Date.parse(b.date) - Date.parse(a.date)
  );
  const at = byDate.findIndex((p) => p.slugAsParams === slug);
  if (at < 0) return { older: null, newer: null };
  return { older: byDate[at + 1] ?? null, newer: byDate[at - 1] ?? null };
}

const REPOSITORY = "https://github.com/vortex-data/vortex.dev";

/** "Edit on GitHub": the post's MDX file on `main`. `slug` is velite's path, "blog/<name>". */
export function editUrl(slug: string): string {
  return `${REPOSITORY}/blob/main/src/content/${slug}.mdx`;
}

/** A post on another site, as `src/content/links.ts` lists it. */
export interface ExternalPost {
  title: string;
  /** The owner's own page for the post. */
  url: string;
  /** ISO 8601, as the page publishes it. */
  date: string;
  /** The owner's host, as the row shows it: "polarsignals.com". */
  source: string;
  authors: readonly string[];
  /** The page's own description. */
  summary: string;
}

/** One row of the BlogIndex card: a post of the site's own, or one elsewhere. */
export interface IndexEntry {
  key: string;
  href: string;
  title: string;
  date: string;
  authors: readonly string[];
  summary: string | null;
  /** The other site's host, or null for a post of the site's own. */
  source: string | null;
}

/**
 * The BlogIndex card's one list: the site's own posts and the posts
 * elsewhere, newest first. The sort is stable, so entries of one date keep
 * the order they came in, own posts first.
 */
export function indexEntries(
  posts: readonly {
    slugAsParams: string;
    title: string;
    date: string;
    authors: readonly string[];
    excerpt?: string | null | undefined;
  }[],
  links: readonly ExternalPost[]
): IndexEntry[] {
  const own = posts.map((p) => ({
    key: `post:${p.slugAsParams}`,
    href: `/blog/${p.slugAsParams}`,
    title: p.title,
    date: p.date,
    authors: p.authors,
    summary: p.excerpt ?? null,
    source: null
  }));
  const away = links.map((l) => ({
    key: `link:${l.url}`,
    href: l.url,
    title: l.title,
    date: l.date,
    authors: l.authors,
    summary: l.summary,
    source: l.source
  }));
  return [...own, ...away].sort(
    (a, b) => Date.parse(b.date) - Date.parse(a.date)
  );
}

/**
 * The BlogIndex card's rows by year, newest year first: one heading and one
 * list per year. The rows keep their order, so the index stays one run in
 * date order. A row's year is its date's UTC year, as its date line reads.
 */
export function byYear(
  entries: readonly IndexEntry[]
): { year: string; entries: IndexEntry[] }[] {
  const groups: { year: string; entries: IndexEntry[] }[] = [];
  for (const entry of entries) {
    const year = String(new Date(entry.date).getUTCFullYear());
    const last = groups.at(-1);
    if (last?.year === year) last.entries.push(entry);
    else groups.push({ year, entries: [entry] });
  }
  return groups;
}
