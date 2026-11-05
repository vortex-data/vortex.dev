import { getBenchSummary, summaryForPage } from "@/lib/bench-summary";
import { getAllPosts } from "@/lib/blog";
import { siteLlmsText } from "@/lib/llms";
import { getSparkVersion } from "@/lib/maven";

// Built with the homepage's figures and refreshed at most once a day, like
// the homepage. bench.vortex.dev/llms.txt is bench's own (next.config.mjs
// rewrites that host's paths first).
export const dynamic = "force-static";
export const revalidate = 86400;

/** vortex.dev/llms.txt (https://llmstxt.org): what Vortex is, its results, and where to read more. */
export async function GET() {
  const [sparkVersion, summary] = await Promise.all([
    getSparkVersion(),
    getBenchSummary()
  ]);
  return new Response(
    // Like the homepage, a daily rebuild that cannot read bench keeps the
    // last file and its figures.
    siteLlmsText({
      bench: summaryForPage(summary),
      sparkVersion,
      posts: getAllPosts()
    }),
    { headers: { "content-type": "text/plain; charset=utf-8" } }
  );
}
