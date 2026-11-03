"use client";

import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useRef } from "react";
import { CloseIcon, MenuIcon } from "@/components/icons";
import { navLinks } from "@/lib/nav";

/** Where the header is: on bench, the path of bench's landing page. */
export type HeaderPlace = { bench?: { home: string } | undefined };

/**
 * The header's links (`navLinks`). They are a client component only to mark
 * the current place: the blog's link takes `aria-current="page"` on the
 * index and `"true"` (the current section) on a post, and bench's link does
 * the same on bench.
 */
function NavLinks({ bench }: HeaderPlace) {
  // Null only outside a router: a test's static render.
  const pathname = usePathname() ?? "";
  return (
    <>
      {navLinks(pathname, bench).map(({ label, href, internal, current }) => {
        const props = {
          className: "vx-label vx-nav-link",
          href,
          ...(current ? { "aria-current": current } : {})
        };
        return internal ? (
          <NextLink key={label} {...props}>
            {label}
          </NextLink>
        ) : (
          <a key={label} {...props}>
            {label}
          </a>
        );
      })}
    </>
  );
}

/** The header's primary nav, on one row with the wordmark. */
export function HeaderNav({ bench }: HeaderPlace) {
  return (
    <nav className="vx-header-nav" aria-label="Primary">
      <NavLinks bench={bench} />
    </nav>
  );
}

/**
 * The same links behind the Menu button, for narrow screens (the design
 * system's CSS shows one or the other). It is a <details>, so it opens
 * without scripts. With them it closes when a link changes the page, on
 * Escape, and on a click outside it. `spill` holds the rows of the end
 * group's items that move into the panel on a phone (bench's GitHub button
 * and theme toggle), after the links.
 */
export function HeaderMenu({
  bench,
  spill
}: HeaderPlace & { spill?: ReactNode }) {
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
        <NavLinks bench={bench} />
        {spill}
      </nav>
    </details>
  );
}
