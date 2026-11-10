import type { MetadataRoute } from "next";
import { externalPosts } from "@/content/links";
import { getAllPosts } from "@/lib/blog";
import { baseUrl } from "@/lib/constants";

export default function sitemap(): MetadataRoute.Sitemap {
  // The homepage's figures change daily, so it is as new as the build. The
  // blog index changes only when a post joins it, the site's own or one
  // elsewhere, so it is as new as its newest post: a date that moves on
  // every build would teach crawlers to ignore lastmod.
  const now = new Date();
  const posts = getAllPosts();
  const newestPost = new Date(
    Math.max(...[...posts, ...externalPosts].map((p) => Date.parse(p.date)))
  );

  const staticEntries: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1.0
    },
    {
      url: `${baseUrl}/blog`,
      lastModified: newestPost,
      changeFrequency: "weekly",
      priority: 0.9
    }
  ];

  const postEntries: MetadataRoute.Sitemap = posts.map((post) => ({
    url: `${baseUrl}/blog/${post.slugAsParams}`,
    lastModified: new Date(post.date),
    changeFrequency: "monthly",
    priority: 0.7
  }));

  return [...staticEntries, ...postEntries];
}
