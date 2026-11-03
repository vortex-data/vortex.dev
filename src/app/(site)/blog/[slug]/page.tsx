import type { Metadata } from "next";
import NextLink from "next/link";
import { notFound } from "next/navigation";
import { PostEnd } from "@/components/blog/post-end";
import { ArrowBackIcon } from "@/components/icons";
import { MDXRenderer } from "@/components/MDXRenderer";
import { getAllPosts, getAllSlugs, getPostBySlug } from "@/lib/blog";
import { baseUrl, siteName } from "@/lib/constants";
import { adjacentPosts, bylineParts } from "@/lib/posts";

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

  const description = post.excerpt || `Read "${post.title}" on the Vortex blog`;

  return {
    title: `${post.title} | Vortex Blog`,
    description,
    openGraph: {
      title: `${post.title} | Vortex Blog`,
      description,
      siteName,
      url: `${baseUrl}/blog/${slug}`,
      type: "article",
      locale: "en_US",
      publishedTime: post.date
    },
    alternates: {
      canonical: `${baseUrl}/blog/${slug}`
    }
  };
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const { slug } = await params;
  const post = getPostBySlug(slug);

  if (!post) {
    notFound();
  }

  const url = `${baseUrl}/blog/${slug}`;
  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.excerpt ?? undefined,
    datePublished: post.date,
    author: post.authors.map((name) => ({
      "@type": "Person",
      name
    })),
    publisher: {
      "@type": "Organization",
      name: siteName,
      url: baseUrl
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    image: `${url}/opengraph-image`
  };

  const { older, newer } = adjacentPosts(getAllPosts(), slug);
  const [date, authors, readingTime] = bylineParts(post);

  // The design system's Article card: the title, the dek and a mono byline,
  // then the post in a 68ch reading column on `surface`, and its ending: the
  // older and newer posts, links and the sign-up. The post's cover is its
  // Open Graph image only. Its neighbours are the site's own posts by date.
  return (
    <div className="blog-page">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }}
      />
      <NextLink href="/blog" className="vx-label vx-nav-link blog-back">
        <ArrowBackIcon />
        Back to blog
      </NextLink>
      <article className="vx-card vx-article vx-reading">
        <header className="vx-article-head">
          <h1 className="vx-h1 vx-article-title">{post.title}</h1>
          {post.excerpt && <p className="vx-article-dek">{post.excerpt}</p>}
          <p className="vx-label vx-article-byline">
            <time className="blog-nowrap" dateTime={post.date}>
              {date}
            </time>
            {` · ${authors} · `}
            <span className="blog-nowrap">{readingTime}</span>
          </p>
        </header>
        <div className="vx-prose">
          <MDXRenderer code={post.body} />
        </div>
        <PostEnd slug={post.slug} older={older} newer={newer} />
      </article>
    </div>
  );
}
