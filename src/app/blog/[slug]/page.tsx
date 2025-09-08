import { getAllSlugs, getPostBySlug } from "@/lib/blog";
import { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";

interface BlogPostPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  const slugs = getAllSlugs();
  return slugs.map((slug) => ({
    slug
  }));
}

export async function generateMetadata({
  params
}: BlogPostPageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);

  if (!post) {
    return {
      title: "Post Not Found | Vortex Blog"
    };
  }

  return {
    title: `${post.title} | Vortex Blog`,
    description: post.excerpt || `Read "${post.title}" on the Vortex blog`,
    openGraph: {
      title: `${post.title} | Vortex Blog`,
      description: post.excerpt || `Read "${post.title}" on the Vortex blog`,
      siteName: "Vortex",
      url: `https://vortex.dev/blog/${slug}`,
      type: "article",
      locale: "en_US",
      publishedTime: post.date
    },
    alternates: {
      canonical: `https://vortex.dev/blog/${slug}`
    }
  };
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const { slug } = await params;
  const post = getPostBySlug(slug);

  if (!post) {
    notFound();
  }

  return (
    <div className="min-h-screen w-full bg-background text-white">
      <div className="max-w-6xl mx-auto px-4 py-16">
        {/* Back to blog link */}
        <Link
          href="/blog"
          className="inline-flex items-center gap-2 text-grey font-mono text-sm hover:text-white transition-colors mb-8"
        >
          ← Back to blog
        </Link>

        {/* Post header */}
        <header className="mb-12">
          <h1 className="text-3xl md:text-5xl font-funnel font-light text-white mb-6">
            {post.title}
          </h1>

          <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-8 text-grey font-mono text-sm">
            <time dateTime={post.date}>
              {new Date(post.date).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric"
              })}
            </time>

            <div className="flex items-center gap-2">
              <span>by</span>
              <span className="text-white">{post.authors.join(", ")}</span>
            </div>
          </div>
        </header>

        {/* Post content */}
        <article className="dashed-top p-4 md:p-6">
          <div className="w-full max-w-none">
            <ReactMarkdown
              components={{
                h1: ({ children }) => (
                  <h1 className="text-2xl md:text-3xl font-sans font-semibold text-white mt-8 mb-4 first:mt-0">
                    {children}
                  </h1>
                ),
                h2: ({ children }) => (
                  <h2 className="text-xl md:text-2xl font-sans font-semibold text-white mt-8 mb-4">
                    {children}
                  </h2>
                ),
                h3: ({ children }) => (
                  <h3 className="text-lg md:text-xl font-sans font-semibold text-white mt-6 mb-3">
                    {children}
                  </h3>
                ),
                p: ({ children }) => (
                  <p className="text-grey font-sans text-base leading-relaxed mb-4 break-words">
                    {children}
                  </p>
                ),
                ul: ({ children }) => (
                  <ul className="text-grey my-4 list-disc ml-6 w-full max-w-none">
                    {children}
                  </ul>
                ),
                ol: ({ children }) => (
                  <ol className="text-grey my-4 list-decimal ml-6 w-full max-w-none">
                    {children}
                  </ol>
                ),
                li: ({ children }) => (
                  <li className="text-grey mb-2 break-words w-full max-w-none">
                    {children}
                  </li>
                ),
                blockquote: ({ children }) => (
                  <blockquote className="border-l-4 border-white pl-4 italic text-grey mb-4">
                    {children}
                  </blockquote>
                ),
                code: ({ children, className }) => {
                  const isInline = !className;
                  if (isInline) {
                    return (
                      <code className="bg-white/10 text-white font-mono text-sm px-1.5 py-0.5 rounded">
                        {children}
                      </code>
                    );
                  }
                  return (
                    <code className="block bg-white/5 text-white font-mono text-sm p-4 rounded overflow-x-auto mb-4">
                      {children}
                    </code>
                  );
                },
                pre: ({ children }) => (
                  <pre className="bg-white/5 text-white font-mono text-sm p-4 rounded overflow-x-auto mb-4">
                    {children}
                  </pre>
                ),
                a: ({ children, href }) => (
                  <a
                    href={href}
                    className="text-white underline hover:text-grey transition-colors"
                    target={href?.startsWith("http") ? "_blank" : undefined}
                    rel={
                      href?.startsWith("http")
                        ? "noopener noreferrer"
                        : undefined
                    }
                  >
                    {children}
                  </a>
                ),
                strong: ({ children }) => (
                  <strong className="text-white font-semibold">
                    {children}
                  </strong>
                ),
                em: ({ children }) => (
                  <em className="text-white italic">{children}</em>
                )
              }}
            >
              {post.content}
            </ReactMarkdown>
          </div>
        </article>
      </div>
    </div>
  );
}
