"use client";

import NextLink from "next/link";
import { useEffect } from "react";

/**
 * The error page: the design system's Status card without the mark, so a
 * page that failed draws as little as it can. "Try again" renders the page
 * again through `reset`. Next requires a client component here. A server
 * error carries a digest, the key to its entry in the server's log, which
 * the page shows as a machine reference for a bug report.
 */
export default function ErrorPage({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[error.tsx] segment error:", error);
  }, [error]);

  return (
    <div className="vx-status">
      <div className="vx-status-text">
        <span className="vx-label vx-eyebrow">Error</span>
        <h1 className="vx-h1">This page did not load.</h1>
        <p className="vx-lede vx-status-sentence">
          The error may be temporary.
        </p>
        <div className="vx-btn-row">
          <button
            type="button"
            className="vx-btn vx-btn-primary"
            onClick={reset}
          >
            Try again
          </button>
          <NextLink className="vx-btn vx-btn-secondary" href="/">
            Go to the homepage
          </NextLink>
        </div>
        {error.digest && (
          <p className="vx-label-sm">
            Reference · <code className="vx-ref">{error.digest}</code>
          </p>
        )}
      </div>
    </div>
  );
}
