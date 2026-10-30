import type { Metadata } from "next";
import { PostLead } from "@/components/blog/post-lead";
import { PostRows } from "@/components/blog/post-rows";
import { NewsletterForm } from "@/components/newsletter-form";
import { getAllPosts } from "@/lib/blog";
import { splitLead } from "@/lib/posts";

export const metadata: Metadata = {
  title: "Blog | Vortex",
  description:
    "Latest updates and insights from the Vortex team about columnar file formats, performance optimization, and cutting-edge research.",
  openGraph: {
    title: "Blog | Vortex",
    description:
      "Latest updates and insights from the Vortex team about columnar file formats, performance optimization, and cutting-edge research.",
    siteName: "Vortex",
    url: "https://vortex.dev/blog",
    type: "website",
    locale: "en_US"
  },
  alternates: {
    canonical: "https://vortex.dev/blog"
  }
};

const FEEDS = [
  { href: "/rss/feed.xml", label: "RSS" },
  { href: "/rss/feed.atom", label: "Atom" },
  { href: "/rss/feed.json", label: "JSON" }
] as const;

/**
 * The design system's BlogIndex card: the heading with the feeds, the
 * newest deep dive as the lead, then the other posts as compact rows, newest
 * first. The newsletter sign-up closes the list.
 */
export default function BlogPage() {
  const posts = getAllPosts();
  const { lead, rest } = splitLead(posts);
  const restLabel = rest.every((p) => p.kind === "bulletin")
    ? "Bulletins"
    : "More posts";

  return (
    <div className="blog-page">
      <div className="vx-blog-head">
        <h1 className="vx-h2 vx-blog-title">Blog</h1>
        <nav className="vx-label vx-blog-feeds" aria-label="Feeds">
          {FEEDS.map((f) => (
            <a key={f.href} className="vx-nav-link" href={f.href}>
              {f.label}
            </a>
          ))}
        </nav>
      </div>
      {posts.length === 0 && (
        <p className="vx-small blog-empty">No posts yet.</p>
      )}
      {lead ? (
        <>
          <PostLead post={lead} />
          {rest.length > 0 && (
            <>
              <h2 className="vx-label vx-posts-head">{restLabel}</h2>
              <PostRows posts={rest} heading="h3" compact />
            </>
          )}
        </>
      ) : (
        posts.length > 0 && <PostRows posts={posts} heading="h2" />
      )}
      <NewsletterForm />
    </div>
  );
}
