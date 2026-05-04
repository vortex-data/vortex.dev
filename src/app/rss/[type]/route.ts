import { Feed } from "feed";
import { getAllPosts } from "@/lib/blog";
import { baseUrl } from "@/lib/constants";

export async function GET(request: Request) {
  const posts = getAllPosts();
  const date = new Date();

  const feed = new Feed({
    title: "Vortex Blog",
    description: "Updates and insights from the Vortex team",
    id: baseUrl,
    link: baseUrl,
    favicon: `${baseUrl}/favicon.ico`,
    copyright: `All rights reserved ${date.getFullYear()}, Vortex`,
    generator: "rss feed",
    feedLinks: {
      rss2: `${baseUrl}/rss/feed.xml`,
      json: `${baseUrl}/rss/feed.json`,
      atom: `${baseUrl}/rss/feed.atom`
    }
  });

  for (const post of posts) {
    const url = `${baseUrl}/blog/${post.slugAsParams}`;
    feed.addItem({
      title: post.title,
      id: url,
      link: url,
      description: post.excerpt ?? "",
      content: post.excerpt ?? "",
      date: new Date(post.date),
      author: post.authors.map((name) => ({ name }))
    });
  }

  const type = request.url.split("/").pop();
  let content: string;
  let contentType: string;

  switch (type) {
    case "feed.xml":
      content = feed.rss2();
      contentType = "application/xml";
      break;
    case "feed.json":
      content = feed.json1();
      contentType = "application/json";
      break;
    case "feed.atom":
      content = feed.atom1();
      contentType = "application/atom+xml";
      break;
    default:
      return new Response("Not found", { status: 404 });
  }

  return new Response(content, {
    headers: {
      "Content-Type": `${contentType}; charset=utf-8`,
      "Cache-Control": "public, max-age=86400, s-maxage=86400"
    }
  });
}
