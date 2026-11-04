import type { Metadata } from "next";
import SiteLayout, { metadata as siteMetadata } from "./(site)/layout";
import NotFound, { metadata as notFoundMetadata } from "./(site)/not-found";
import { alt, contentType, size } from "./(site)/opengraph-image";

// Every URL no route matches gets the marketing site's 404, in the site's
// layout. The app has two root layouts, the site's and bench's, so Next.js
// has no single layout to compose an unmatched URL's 404 from; this file
// (next.config.mjs `experimental.globalNotFound`) is that page, prerendered
// once like the site's 404 always was. bench's own unmatched paths never
// reach it: `(bench)/bench/[...notFound]` catches them, and bench's
// not-found.tsx draws the same body in bench's layout.
//
// The metadata merges as Next.js merges a page's into its layout's: each
// top-level field of the 404's replaces the layout's. Next.js adds the
// site's `opengraph-image` only to pages under `(site)`, so the share image
// is named here, at the URL next.config.mjs rewrites to it.
const shareImage = { url: "/opengraph-image", alt, type: contentType, ...size };

export const metadata: Metadata = {
  ...siteMetadata,
  ...notFoundMetadata,
  openGraph: { ...notFoundMetadata.openGraph, images: [shareImage] },
  twitter: { card: "summary_large_image", images: [shareImage] }
};

export default function GlobalNotFound() {
  return (
    <SiteLayout>
      <NotFound />
    </SiteLayout>
  );
}
