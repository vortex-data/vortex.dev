import { notFound } from "next/navigation";
import { getPostBySlug } from "@/lib/blog";
import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "@/lib/og";

export const alt = "Vortex blog post";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function OgImage({
  params
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) notFound();

  return renderOgImage({
    title: post.title,
    description: post.excerpt,
    eyebrow: "Blog"
  });
}
