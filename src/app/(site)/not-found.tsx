import type { Metadata } from "next";
import NextLink from "next/link";
import { AsciiMark } from "@/components/ascii-mark";

const TITLE = "Page not found | Vortex";
// The page's description for search and link previews. The page itself
// says only "Page not found." under its code, because this would repeat it.
const SENTENCE = "There is no page at this address.";

// No canonical and no og:url: a missing page is not the homepage. Without
// `alternates`, the layout's RSS links stay.
export const metadata: Metadata = {
  title: TITLE,
  applicationName: "Vortex",
  description: SENTENCE,
  openGraph: {
    title: TITLE,
    description: SENTENCE,
    siteName: "Vortex",
    type: "website",
    locale: "en_US"
  }
};

/**
 * The 404 page: the design system's Status card with the mark. The words
 * follow Writing › Site errors. It is Dark, as every page outside the blog
 * is. Under /blog it follows the reader's theme, and the mark draws in Light
 * too.
 */
export default function NotFound() {
  return (
    <div className="vx-status has-mark">
      <div className="vx-status-text">
        <h1 className="vx-status-code">404</h1>
        <p className="vx-status-sentence">Page not found.</p>
        <div className="vx-btn-row">
          <NextLink className="vx-btn vx-btn-primary" href="/">
            Go to the homepage
          </NextLink>
          <a className="vx-btn vx-btn-secondary" href="https://docs.vortex.dev">
            Read the docs
          </a>
          <NextLink className="vx-btn vx-btn-secondary" href="/blog">
            Read the blog
          </NextLink>
        </div>
      </div>
      <div className="vx-status-mark">
        <AsciiMark />
      </div>
    </div>
  );
}
