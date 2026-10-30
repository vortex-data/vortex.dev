import { notFound } from "next/navigation";
import { getAllSlugs, getPostBySlug } from "@/lib/blog";
import { OG_CONTENT_TYPE, OG_SIZE, renderPostOgImage } from "@/lib/og";
import { formatPostDate } from "@/lib/posts";

export const alt = "Vortex blog post";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

// Drawn at build time, so the fonts are read from the checkout, not at
// request time.
export function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }));
}

export default async function OgImage({
  params
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) notFound();

  return renderPostOgImage({
    slug,
    title: post.title,
    date: formatPostDate(post.date)
  });
}
