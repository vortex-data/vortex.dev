import { LOGOS } from "@/components/logo-banner/logos";
import { externalPosts } from "@/content/links";
import { getBenchSummary, summaryForPage } from "@/lib/bench-summary";
import { getAllPosts } from "@/lib/blog";
import { faqs } from "@/lib/faq";
import { siteLlmsFullText } from "@/lib/llms";
import { getSparkVersion } from "@/lib/maven";

// Built and refreshed like llms.txt, whose text it starts with.
export const dynamic = "force-static";
export const revalidate = 86400;

/** vortex.dev/llms-full.txt: llms.txt, then every post of the site's own in full. */
export async function GET() {
  const [sparkVersion, summary] = await Promise.all([
    getSparkVersion(),
    getBenchSummary()
  ]);
  const bench = summaryForPage(summary);
  return new Response(
    siteLlmsFullText({
      bench,
      sparkVersion,
      faq: faqs({ bench, sparkVersion, ecosystem: LOGOS }),
      posts: getAllPosts(),
      ecosystem: LOGOS,
      elsewhere: externalPosts
    }),
    { headers: { "content-type": "text/plain; charset=utf-8" } }
  );
}
