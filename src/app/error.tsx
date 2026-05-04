"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function GlobalError({
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
    <section className="flex flex-col items-center justify-center text-center px-4 py-24 md:py-32 gap-6 min-h-[60vh]">
      <h1 className="text-3xl md:text-5xl font-funnel font-light text-white">
        Something went wrong
      </h1>
      <p className="text-grey font-mono max-w-xl">
        We hit an unexpected error rendering this page.
        {error.digest ? ` Reference: ${error.digest}` : ""}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3 font-mono text-sm">
        <button
          type="button"
          onClick={reset}
          className="px-4 py-2 border border-white/30 text-white hover:bg-white/5 transition-colors"
        >
          Try again
        </button>
        <Link
          href="/"
          className="px-4 py-2 border border-white/30 text-white hover:bg-white/5 transition-colors"
        >
          Back to home
        </Link>
      </div>
    </section>
  );
}
