import { notFound } from "next/navigation";

/**
 * Every URL no other route matches. The app has two root layouts, the site's
 * and bench's, so Next.js has no single layout to draw an unmatched URL's 404
 * in, and would fall back to its bare default page. This route sends those
 * URLs to the site's own 404 (`../not-found.tsx`) in the site's layout.
 * bench's paths have their own (`(bench)/bench/[...notFound]`).
 */
export default function UnmatchedPath(): never {
  notFound();
}
