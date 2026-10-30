import { formatDay } from "./date";

/** "26 Feb 2026": a post's date in the BlogIndex and Article cards. */
export function formatPostDate(iso: string): string {
  return formatDay(new Date(iso));
}

export type PostKind = "deep-dive" | "bulletin";

const KIND_LABELS: Record<PostKind, string> = {
  "deep-dive": "Deep dive",
  bulletin: "Bulletin"
};

/** A post's kind as the Article card's eyebrow and the index's lead name it. */
export function kindLabel(kind: PostKind): string {
  return KIND_LABELS[kind];
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
 * The Article card's ending: the nearest older and newer posts by date. Each
 * is the nearest of the same kind when there is one, else the nearest of any
 * kind, else null.
 */
export function adjacentPosts<
  T extends { slugAsParams: string; date: string; kind: PostKind }
>(posts: readonly T[], slug: string): { older: T | null; newer: T | null } {
  // Newest first. The sort is stable, so two posts of one day keep the
  // order they came in, and each is the other's neighbour.
  const byDate = [...posts].sort(
    (a, b) => Date.parse(b.date) - Date.parse(a.date)
  );
  const at = byDate.findIndex((p) => p.slugAsParams === slug);
  if (at < 0) return { older: null, newer: null };
  const { kind } = byDate[at] as T;
  const pick = (list: T[]) =>
    list.find((p) => p.kind === kind) ?? list[0] ?? null;
  return {
    older: pick(byDate.slice(at + 1)),
    newer: pick(byDate.slice(0, at).reverse())
  };
}

const REPOSITORY = "https://github.com/vortex-data/vortex.dev";

/** "Edit on GitHub": the post's MDX file on `main`. `slug` is velite's path, "blog/<name>". */
export function editUrl(slug: string): string {
  return `${REPOSITORY}/blob/main/src/content/${slug}.mdx`;
}

/**
 * The BlogIndex card's lead: the newest deep dive, and the other posts in
 * the order given (newest first), which follow it as compact rows. With no
 * deep dive there is no lead.
 */
export function splitLead<T extends { kind: PostKind }>(
  posts: readonly T[]
): { lead: T | null; rest: T[] } {
  const lead = posts.find((p) => p.kind === "deep-dive") ?? null;
  return { lead, rest: posts.filter((p) => p !== lead) };
}
