import { getAllSlugs, getPostBySlug } from "@/lib/blog";
import { MDXRenderer } from "@/components/MDXRenderer";
import { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

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
          <div className="w-full max-w-none prose prose-invert prose-grey">
            <MDXRenderer code={post.body} />
          </div>
        </article>
      </div>
    </div>
  );
}
