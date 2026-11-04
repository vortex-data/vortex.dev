"use client";

import { useLayoutEffect } from "react";
import { lockDark } from "@/lib/theme";

/**
 * Locks the page Dark while it is mounted, for a Dark-only page that a link
 * renders in place, where the script beside it does not run. It mounts
 * before the layout's `RouteTheme` applies the theme, so that sees the lock.
 */
export function DarkLock() {
  useLayoutEffect(() => lockDark(), []);
  return null;
}
