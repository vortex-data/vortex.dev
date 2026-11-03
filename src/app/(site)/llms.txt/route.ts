import { getBenchSummary } from "@/lib/bench-summary";
import { getAllPosts } from "@/lib/blog";
import { siteLlmsText } from "@/lib/llms";
import { getSparkVersion } from "@/lib/maven";

// Built with the homepage's figures and refreshed at most once a day, like
// the homepage. bench.vortex.dev/llms.txt is bench's own (next.config.mjs
// rewrites that host's paths first).
export const revalidate = 86400;

/** vortex.dev/llms.txt (https://llmstxt.org): what Vortex is, its results, and where to read more. */
export async function GET() {
  const [sparkVersion, bench] = await Promise.all([
    getSparkVersion(),
    getBenchSummary()
  ]);
  return new Response(
    siteLlmsText({ bench, sparkVersion, posts: getAllPosts() }),
    { headers: { "content-type": "text/plain; charset=utf-8" } }
  );
}
