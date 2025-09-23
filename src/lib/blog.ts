import { blog } from '#site/content';

export type BlogPost = (typeof blog)[number];

export type BlogPostMeta = (typeof blog)[number];

export function getAllPosts(): BlogPostMeta[] {
  return blog
    .filter((post) => post.published)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export function getPostBySlug(slug: string): BlogPost | null {
  const post = blog.find((post) => post.slugAsParams === slug);
  if (!post || !post.published) return null;

  return post;
}

export function getAllSlugs(): string[] {
  return blog
    .filter((post) => post.published)
    .map((post) => post.slugAsParams);
}
