"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { themeFor } from "@/lib/theme";

/**
 * Client-side navigation keeps the document, so the first-paint script in
 * `<head>` never reruns. This applies the same rule on every route change:
 * the blog follows the reader's stored choice, every other page is Dark.
 */
export function RouteTheme() {
  const pathname = usePathname();
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem("vx-theme");
    } catch {
      // Blocked storage means the default theme.
    }
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)"
    ).matches;
    document.documentElement.dataset.theme = themeFor(
      pathname,
      stored,
      prefersDark
    );
  }, [pathname]);
  return null;
}
