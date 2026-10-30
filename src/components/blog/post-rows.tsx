import NextLink from "next/link";
import type { BlogPostMeta } from "@/lib/blog";
import { formatPostDate } from "@/lib/posts";

/**
 * The BlogIndex card's rows: a list of posts, each the date over the
 * authors, then the title over a one-line excerpt. Each title is a heading
 * one level under the list's own: `h2` on the blog index, under its `h1`,
 * and `h3` under a heading of its own, such as "Bulletins".
 *
 * `compact` is the card's `is-compact` row, for the posts under the lead:
 * the date alone, a `vx-h5` title and the one-line summary.
 */
export function PostRows({
  posts,
  heading,
  compact = false
}: {
  posts: readonly BlogPostMeta[];
  heading: "h2" | "h3";
  compact?: boolean;
}) {
  const Title = heading;
  return (
    <ul className={compact ? "vx-posts is-compact" : "vx-posts"}>
      {posts.map((post) => (
        <li key={post.slug}>
          <NextLink className="vx-post-row" href={`/blog/${post.slugAsParams}`}>
            <span className="vx-label vx-post-row-meta">
              <time dateTime={post.date}>{formatPostDate(post.date)}</time>
              {!compact && <span>{post.authors.join(", ")}</span>}
            </span>
            <Title
              className={`${compact ? "vx-h5" : "vx-h4"} vx-post-row-title`}
            >
              {post.title}
            </Title>
            {post.excerpt && (
              <p className="vx-small vx-post-row-excerpt">{post.excerpt}</p>
            )}
          </NextLink>
        </li>
      ))}
    </ul>
  );
}
