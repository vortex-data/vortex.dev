"use client";

import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { CloseIcon, MenuIcon } from "@/components/icons";
import { blogCurrent } from "@/lib/nav";

/**
 * The header's links. They are a client component only to mark the current
 * place: the blog's link takes `aria-current="page"` on the index and
 * `"true"` (the current section) on a post.
 */
function NavLinks() {
  const pathname = usePathname();
  const current = blogCurrent(pathname);
  return (
    <>
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
        {...(current ? { "aria-current": current } : {})}
      >
        Blog
      </NextLink>
      {/* A redirect to the Slack invite (next.config.mjs). A plain link,
          because a client-side navigation cannot follow it off the site. */}
      <a className="vx-label vx-nav-link" href="/slack">
        Slack
      </a>
    </>
  );
}

/** The header's primary nav, on one row with the wordmark. */
export function HeaderNav() {
  return (
    <nav className="vx-header-nav" aria-label="Primary">
      <NavLinks />
    </nav>
  );
}

/**
 * The same links behind the Menu button, for narrow screens (the design
 * system's CSS shows one or the other). It is a <details>, so it opens
 * without scripts. With them it closes when a link changes the page, on
 * Escape, and on a click outside it.
 */
export function HeaderMenu() {
  const menu = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();

  // A new path closes the menu: a link inside it renders the page in place.
  useEffect(() => {
    if (pathname && menu.current) menu.current.open = false;
  }, [pathname]);

  useEffect(() => {
    const el = menu.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !el.open) return;
      el.open = false;
      el.querySelector("summary")?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      if (el.open && !el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, []);

  return (
    <details ref={menu} className="vx-header-menu">
      <summary className="vx-btn vx-btn-secondary is-mono">
        <MenuIcon className="is-open" />
        <CloseIcon className="is-close" />
        <span className="vx-header-menu-text">Menu</span>
      </summary>
      <nav className="vx-header-menu-panel" aria-label="Primary">
        <NavLinks />
      </nav>
    </details>
  );
}
