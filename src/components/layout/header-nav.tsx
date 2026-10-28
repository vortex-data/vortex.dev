"use client";

import NextLink from "next/link";
import { usePathname } from "next/navigation";

/**
 * The header's primary nav. It is a client component only to mark the
 * current section: the blog's link takes `aria-current="page"` on the index
 * and on every post.
 */
export function HeaderNav() {
  const pathname = usePathname();
  const onBlog = pathname === "/blog" || pathname.startsWith("/blog/");
  return (
    <nav className="vx-header-nav" aria-label="Primary">
      <a className="vx-label vx-nav-link" href="https://docs.vortex.dev">
        Docs
      </a>
      <a className="vx-label vx-nav-link" href="https://bench.vortex.dev">
        Bench
      </a>
      <a className="vx-label vx-nav-link" href="https://explore.vortex.dev">
        Explorer
      </a>
      <NextLink
        className="vx-label vx-nav-link"
        href="/blog"
        {...(onBlog ? { "aria-current": "page" as const } : {})}
      >
        Blog
      </NextLink>
      {/* A redirect to the Slack invite (next.config.mjs). A plain link,
          because a client-side navigation cannot follow it off the site. */}
      <a className="vx-label vx-nav-link" href="/slack">
        Slack
      </a>
    </nav>
  );
}
