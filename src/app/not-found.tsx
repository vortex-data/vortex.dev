import type { Metadata } from "next";
import NextLink from "next/link";
import { AsciiMark } from "@/components/ascii-mark";
import styles from "./status.module.css";

const TITLE = "Page not found | Vortex";
const SENTENCE = "There is no page at this address.";

export const metadata: Metadata = {
  title: TITLE,
  applicationName: "Vortex",
  description: SENTENCE,
  openGraph: {
    title: TITLE,
    description: SENTENCE,
    siteName: "Vortex",
    url: "https://vortex.dev",
    type: "website",
    locale: "en_US"
  },
  alternates: {
    canonical: "https://vortex.dev"
  }
};

/**
 * The 404 page, laid out as the homepage's hero: the Eyebrow, the headline,
 * one sentence and three ways on, with the AsciiMark beside them. It is
 * Dark, as every page outside the blog is. Under /blog it follows the
 * reader's theme, and in Light it leaves the mark out (status.module.css).
 */
export default function NotFound() {
  return (
    <div className={`${styles.page} ${styles.withMark}`}>
      <div className={styles.text}>
        <span className="vx-label vx-eyebrow">404</span>
        <h1 className="vx-h1">Page not found.</h1>
        <p className={`vx-lede ${styles.sentence}`}>{SENTENCE}</p>
        <div className={styles.actions}>
          <NextLink className="vx-btn vx-btn-primary" href="/">
            Go to the homepage
          </NextLink>
          <a className="vx-btn vx-btn-secondary" href="https://docs.vortex.dev">
            Read the docs
          </a>
          <NextLink className="vx-btn vx-btn-secondary" href="/blog">
            Read the blog
          </NextLink>
        </div>
      </div>
      <div className={styles.mark}>
        <AsciiMark className={styles.markHost} />
      </div>
    </div>
  );
}
