"use client";

import NextLink from "next/link";
import { useEffect } from "react";
import styles from "./status.module.css";

/**
 * The error page, laid out as the 404 without the mark: the Eyebrow, the
 * headline, one sentence, then "Try again", which renders the page again
 * through `reset`, and a link home. Next requires a client component here.
 * A server error carries a digest, the key to its entry in the server's
 * log, which the page shows for a bug report.
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
    <div className={styles.page}>
      <div className={styles.text}>
        <span className="vx-label vx-eyebrow">Error</span>
        <h1 className="vx-h1">This page did not load.</h1>
        <p className={`vx-lede ${styles.sentence}`}>
          The error may be temporary, so try again.
        </p>
        <div className={styles.actions}>
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
          <p className={`vx-label-sm ${styles.digest}`}>
            Reference · <span className="vx-keep-case">{error.digest}</span>
          </p>
        )}
      </div>
    </div>
  );
}
