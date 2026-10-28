/**
 * The `aria-current` value for the header's Blog link: the index is the
 * current page, and on a post Blog is the current section.
 */
export function blogCurrent(pathname: string): "page" | "true" | null {
  if (pathname === "/blog") return "page";
  if (pathname.startsWith("/blog/")) return "true";
  return null;
}
