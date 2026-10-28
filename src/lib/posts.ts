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

const MORE_POSTS = 3;

/** The "More posts" list under an article: the other posts, newest first. */
export function morePosts<T extends { slugAsParams: string; date: string }>(
  posts: readonly T[],
  slug: string,
  limit = MORE_POSTS
): T[] {
  return posts
    .filter((p) => p.slugAsParams !== slug)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, limit);
}
