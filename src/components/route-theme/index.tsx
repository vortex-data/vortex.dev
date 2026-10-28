"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { applyRouteTheme } from "@/lib/theme";

/**
 * Client-side navigation keeps the document, so the first-paint script in
 * `<head>` never reruns. This applies the same rule on every route change,
 * and follows the OS while a blog page set to "system" stays open.
 */
export function RouteTheme() {
  const pathname = usePathname();
  useEffect(() => applyRouteTheme(pathname, window), [pathname]);
  return null;
}
