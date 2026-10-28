import type { Metadata } from "next";
import { PostRows } from "@/components/blog/post-rows";
import { NewsletterForm } from "@/components/newsletter-form";
import { getAllPosts } from "@/lib/blog";

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
 * The design system's BlogIndex card: the heading with the feeds, then one
 * row per post, newest first. The newsletter sign-up closes the list.
 */
export default function BlogPage() {
  const posts = getAllPosts();

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
      {posts.length === 0 ? (
        <p className="vx-small blog-empty">No posts yet.</p>
      ) : (
        <PostRows posts={posts} />
      )}
      <NewsletterForm />
    </div>
  );
}
