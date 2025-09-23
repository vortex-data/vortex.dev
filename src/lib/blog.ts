import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

const blogDirectory = path.join(process.cwd(), 'src/content/blog');

export interface BlogPost {
  slug: string;
  title: string;
  date: string;
  authors: string[];
  content: string;
  excerpt?: string;
  published: boolean;
}

export interface BlogPostMeta {
  slug: string;
  title: string;
  date: string;
  authors: string[];
  excerpt?: string;
  published: boolean;
}

export function getAllPosts(): BlogPostMeta[] {
  if (!fs.existsSync(blogDirectory)) {
    return [];
  }

  const filenames = fs.readdirSync(blogDirectory);
  const posts = filenames
    .filter((name) => name.endsWith('.mdx'))
    .map((name) => {
      const slug = name.replace(/\.mdx$/, '');
      const fullPath = path.join(blogDirectory, name);
      const fileContents = fs.readFileSync(fullPath, 'utf8');
      const { data } = matter(fileContents);

      return {
        slug,
        title: data.title || slug,
        date: data.date || '',
        authors: Array.isArray(data.authors) ? data.authors : [data.authors || 'Anonymous'],
        excerpt: data.excerpt || '',
        published: data.published !== false,
      };
    })
    .filter((post) => post.published)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return posts;
}

export function getPostBySlug(slug: string): BlogPost | null {
  if (!fs.existsSync(blogDirectory)) {
    return null;
  }

  const fullPath = path.join(blogDirectory, `${slug}.mdx`);

  if (!fs.existsSync(fullPath)) {
    return null;
  }

  const fileContents = fs.readFileSync(fullPath, 'utf8');
  const { data, content } = matter(fileContents);

  return {
    slug,
    title: data.title || slug,
    date: data.date || '',
    authors: Array.isArray(data.authors) ? data.authors : [data.authors || 'Anonymous'],
    content,
    excerpt: data.excerpt || '',
    published: data.published !== false,
  };
}

export function getAllSlugs(): string[] {
  if (!fs.existsSync(blogDirectory)) {
    return [];
  }

  const filenames = fs.readdirSync(blogDirectory);
  return filenames
    .filter((name) => name.endsWith('.mdx'))
    .map((name) => {
      const slug = name.replace(/\.mdx$/, '');
      const fullPath = path.join(blogDirectory, name);
      const fileContents = fs.readFileSync(fullPath, 'utf8');
      const { data } = matter(fileContents);

      // Only include published posts (defaults to true)
      return data.published !== false ? slug : null;
    })
    .filter((slug): slug is string => slug !== null);
}