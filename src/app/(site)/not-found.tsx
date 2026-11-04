import type { Metadata } from "next";
import { NotFoundStatus } from "@/components/not-found";

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

/** The 404 page: the body every surface shares (`NotFoundStatus`). */
export default function NotFound() {
  return <NotFoundStatus />;
}
