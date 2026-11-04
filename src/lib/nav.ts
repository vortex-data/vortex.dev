/**
 * The `aria-current` value for the header's Blog link: the index is the
 * current page, and on a post Blog is the current section.
 */
export function blogCurrent(pathname: string): "page" | "true" | null {
  if (pathname === "/blog") return "page";
  if (pathname.startsWith("/blog/")) return "true";
  return null;
}

export type NavLink = {
  label: string;
  href: string;
  /** A page of this app, which a client-side navigation can reach. */
  internal: boolean;
  current: "page" | "true" | null;
};

const SITE = "https://vortex.dev";

/**
 * The header's links. On the site, Blog is its own path. On
 * bench, which is served from its own host, they point back to the site,
 * and Bench is the current section: the current page on its landing page.
 * `home` is the bench landing page's path for the request's host.
 */
export function navLinks(
  pathname: string,
  bench?: { home: string }
): NavLink[] {
  const site = bench ? SITE : "";
  const benchLanding =
    pathname === "/" || pathname === "/bench" || pathname === bench?.home;
  return [
    {
      label: "Docs",
      href: "https://docs.vortex.dev",
      internal: false,
      current: null
    },
    {
      label: "Bench",
      href: bench ? bench.home : "https://bench.vortex.dev",
      internal: false,
      current: bench ? (benchLanding ? "page" : "true") : null
    },
    {
      label: "Explorer",
      href: "https://explore.vortex.dev",
      internal: false,
      current: null
    },
    {
      label: "Blog",
      href: `${site}/blog`,
      internal: !bench,
      current: bench ? null : blogCurrent(pathname)
    }
  ];
}

/**
 * The header's socials beside the GitHub button. Slack's is the site's
 * redirect to the Slack invite (next.config.mjs), so on bench it points back
 * to the site. Both are plain links: a client-side navigation cannot follow
 * the redirect off the site.
 */
export function socialLinks(bench?: { home: string }) {
  const site = bench ? SITE : "";
  return { slack: `${site}/slack`, x: "https://x.com/vortexdotdev" };
}
