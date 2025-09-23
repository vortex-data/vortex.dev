import { getAllPosts } from "@/lib/blog";
import { Metadata } from "next";
import Link from "next/link";

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

export default function BlogPage() {
  const posts = getAllPosts();

  return (
    <div className="min-h-screen w-full bg-background text-white">
      <div className="max-w-5xl mx-auto px-4 py-16">
        <div className="mb-12">
          <h1 className="text-4xl md:text-6xl font-funnel font-light text-white mb-4">
            Blog
          </h1>
          <p className="text-grey font-mono text-lg">
            Updates and insights from the Vortex team
          </p>
        </div>

        {posts.length === 0 ? (
          <div className="dashed-top dashed-bottom p-8">
            <p className="text-grey font-mono text-center">
              No blog posts yet. Check back soon for updates!
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {posts.map((post) => (
              <Link
                key={post.slug}
                href={`/blog/${post.slugAsParams}`}
                className="block group"
              >
                <article className="dashed-top dashed-bottom p-6 hover:bg-white/5 transition-colors">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-3">
                    <h2 className="text-xl md:text-2xl font-sans font-medium text-white group-hover:text-grey transition-colors">
                      {post.title}
                    </h2>
                    <time
                      dateTime={post.date}
                      className="text-grey font-mono text-sm mt-2 md:mt-0"
                    >
                      {new Date(post.date).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "long",
                        day: "numeric"
                      })}
                    </time>
                  </div>

                  <div className="flex flex-col md:flex-row md:items-center md:justify-between">
                    {post.excerpt && (
                      <p className="text-grey font-sans text-base mb-3 md:mb-0 md:mr-6">
                        {post.excerpt}
                      </p>
                    )}

                    <div className="flex items-center gap-2">
                      <span className="text-grey font-mono text-sm">by</span>
                      <span className="text-white font-mono text-sm">
                        {post.authors.join(", ")}
                      </span>
                    </div>
                  </div>
                </article>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
