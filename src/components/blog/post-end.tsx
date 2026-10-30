import NextLink from "next/link";
import { NewsletterForm } from "@/components/newsletter-form";
import type { BlogPostMeta } from "@/lib/blog";
import { editUrl, kindLabel } from "@/lib/posts";

function NavLink({
  post,
  side
}: {
  post: BlogPostMeta;
  side: "prev" | "next";
}) {
  return (
    <NextLink
      className={`vx-post-nav-link is-${side}`}
      href={`/blog/${post.slugAsParams}`}
      rel={side}
    >
      <span className="vx-label">
        {`${side === "prev" ? "Previous" : "Next"} · ${kindLabel(post.kind).toLowerCase()}`}
      </span>
      <span className="vx-h5 vx-post-nav-title">{post.title}</span>
    </NextLink>
  );
}

/**
 * The Article card's ending: the older and newer posts, one row of links
 * (Slack, the post's file on GitHub, the feed), then the newsletter sign-up,
 * which is on the page once.
 */
export function PostEnd({
  slug,
  older,
  newer
}: {
  slug: string;
  older: BlogPostMeta | null;
  newer: BlogPostMeta | null;
}) {
  return (
    <footer className="vx-article-end">
      {(older || newer) && (
        <nav className="vx-post-nav" aria-label="Older and newer posts">
          {older && <NavLink post={older} side="prev" />}
          {newer && <NavLink post={newer} side="next" />}
        </nav>
      )}
      <nav className="vx-label vx-article-links" aria-label="About this post">
        {/* A redirect to the Slack invite (next.config.mjs). */}
        <a className="vx-nav-link" href="/slack">
          Discuss in Slack
        </a>
        <a className="vx-nav-link" href={editUrl(slug)}>
          Edit on GitHub
        </a>
        <a className="vx-nav-link" href="/rss/feed.xml">
          RSS
        </a>
      </nav>
      <NewsletterForm />
    </footer>
  );
}
