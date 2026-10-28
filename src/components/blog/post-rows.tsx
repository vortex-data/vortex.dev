import NextLink from "next/link";
import type { BlogPostMeta } from "@/lib/blog";
import { formatPostDate } from "@/lib/posts";

/**
 * The BlogIndex card's rows: the date over the authors, then the title over
 * a one-line excerpt. The blog index lists every post this way, and a post
 * lists its "More posts".
 */
export function PostRows({ posts }: { posts: readonly BlogPostMeta[] }) {
  return (
    <div className="vx-posts">
      {posts.map((post) => (
        <NextLink
          key={post.slug}
          className="vx-post-row"
          href={`/blog/${post.slugAsParams}`}
        >
          <span className="vx-label vx-post-row-meta">
            <time dateTime={post.date}>{formatPostDate(post.date)}</time>
            <span>{post.authors.join(", ")}</span>
          </span>
          <span className="vx-h4 vx-post-row-title">{post.title}</span>
          {post.excerpt && (
            <span className="vx-small vx-post-row-excerpt">{post.excerpt}</span>
          )}
        </NextLink>
      ))}
    </div>
  );
}
