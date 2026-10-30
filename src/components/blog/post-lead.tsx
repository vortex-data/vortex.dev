import NextLink from "next/link";
import type { BlogPostMeta } from "@/lib/blog";
import { bylineParts, kindLabel } from "@/lib/posts";
import { PostCover } from "./post-cover";

/**
 * The BlogIndex card's lead: the newest deep dive as one link. Its cover,
 * then the kind, the title, the dek and the date, authors and reading time.
 */
export function PostLead({ post }: { post: BlogPostMeta }) {
  const [date, authors, readingTime] = bylineParts(post);
  return (
    <NextLink className="vx-post-lead" href={`/blog/${post.slugAsParams}`}>
      <PostCover slug={post.slugAsParams} />
      <p className="vx-label vx-eyebrow vx-article-kind">
        {kindLabel(post.kind)}
      </p>
      <h2 className="vx-h2 vx-post-lead-title">{post.title}</h2>
      {post.excerpt && (
        <p className="vx-lede vx-post-lead-dek">{post.excerpt}</p>
      )}
      <p className="vx-label vx-post-lead-meta">
        <time dateTime={post.date}>{date}</time>
        {` · ${authors} · ${readingTime}`}
      </p>
    </NextLink>
  );
}
