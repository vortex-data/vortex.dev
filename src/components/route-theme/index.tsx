"use client";

import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect } from "react";
import { applyRouteTheme } from "@/lib/theme";

// A layout effect runs after React commits a route but before the browser
// paints it; the server has no layout phase, so it gets a plain effect.
const useBeforePaint =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Client-side navigation keeps the document, so the first-paint script in
 * `<head>` never reruns. This applies the same rule on every route change,
 * before the new route paints, and follows the OS while a blog page set to
 * "system" stays open.
 */
export function RouteTheme() {
  const pathname = usePathname();
  useBeforePaint(() => applyRouteTheme(pathname, window), [pathname]);
  return null;
}
