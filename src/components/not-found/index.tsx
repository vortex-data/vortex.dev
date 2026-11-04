import NextLink from "next/link";
import { AsciiMark } from "@/components/ascii-mark";
import { DotField } from "@/components/dot-field";

/**
 * The 404's body, the same on every surface (the design system's DECISIONS
 * 36): the Status card with the mark, over the system's DotField, so the
 * mark leaves its own dots to it. The words follow Writing › Site errors.
 * It follows the reader's theme, and the mark draws in Light too. `origin` is
 * the site's, for a page served from another host (bench), where the site's
 * paths are not this host's.
 */
export function NotFoundStatus({ origin = "" }: { origin?: string } = {}) {
  const Link = origin ? "a" : NextLink;
  return (
    <div className="vx-status has-mark has-dot-field">
      <DotField />
      <div className="vx-status-text">
        <h1 className="vx-status-code">404</h1>
        <p className="vx-status-sentence">Page not found.</p>
        <div className="vx-btn-row">
          <Link className="vx-btn vx-btn-primary" href={`${origin}/`}>
            Go to the homepage
          </Link>
          <a className="vx-btn vx-btn-secondary" href="https://docs.vortex.dev">
            Read the docs
          </a>
          <Link className="vx-btn vx-btn-secondary" href={`${origin}/blog`}>
            Read the blog
          </Link>
        </div>
      </div>
      <div className="vx-status-mark">
        <AsciiMark field={false} />
      </div>
    </div>
  );
}
