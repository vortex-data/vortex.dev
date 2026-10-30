import type { Metadata } from "next";
import SiteLayout, { metadata as siteMetadata } from "./(site)/layout";
import NotFound, { metadata as notFoundMetadata } from "./(site)/not-found";

// Every URL no route matches gets the marketing site's 404, in the site's
// layout. The app has two root layouts, the site's and bench's, so Next.js
// has no single layout to compose an unmatched URL's 404 from; this file
// (next.config.mjs `experimental.globalNotFound`) is that page, prerendered
// once like the site's 404 always was. bench's own unmatched paths never
// reach it: `(bench)/bench/[...notFound]` keeps them in bench's layout.
//
// The metadata merges as Next.js merges a page's into its layout's: each
// top-level field of the 404's replaces the layout's.
export const metadata: Metadata = { ...siteMetadata, ...notFoundMetadata };

export default function GlobalNotFound() {
  return (
    <SiteLayout>
      <NotFound />
    </SiteLayout>
  );
}
