import { Feed } from "feed";
import { getAllPosts } from "@/lib/blog";
import { baseUrl } from "@/lib/constants";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ type: string }> }
) {
  // The site's own posts only. The blog index also lists posts on other
  // sites (`src/content/links.ts`), but those are not ours to syndicate. Only
  // JSON Feed marks a link item (`external_url`). In RSS and Atom a link item
  // reads as our own post, so the three feeds would disagree.
  const posts = getAllPosts();

  const feed = new Feed({
    title: "Vortex Blog",
    description: "Updates and insights from the Vortex team",
    id: baseUrl,
    link: baseUrl,
    favicon: `${baseUrl}/favicon.ico`,
    // The posts are CC-BY-4.0 (REUSE.toml), and the project is a Series of
    // LF Projects, LLC.
    copyright: "CC-BY-4.0, Vortex a Series of LF Projects, LLC",
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

  // The route parameter, not the URL's last segment, which would carry any
  // query string (`feed.xml?utm_source=x`) and miss every case below.
  const { type } = await params;
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
