import type { Metadata } from "next";
import { AsciiMark } from "@/components/ascii-mark";
import { InstallTabs } from "@/components/install-tabs";
import { getSparkVersion } from "@/lib/maven";
import styles from "./page.module.css";

const TITLE = "Vortex | The fastest columnar file format";
const DESCRIPTION =
  "Vortex is a columnar file format for fast scans and fast random access, with Rust, Python, DuckDB and Spark support. An Apache-2.0 project of the Linux Foundation.";

export const metadata: Metadata = {
  title: TITLE,
  applicationName: "Vortex",
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
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
 * The design system's Home card: the hero (Eyebrow, headline, InstallTabs
 * and the AsciiMark), then the benchmark and logo bands. The Spark version is
 * read at build time and again at most once a day, so the page stays static.
 */
export default async function Home() {
  const sparkVersion = await getSparkVersion();
  return (
    <div className={styles.home}>
      <section className={styles.hero}>
        <div className={styles.text}>
          <span className="vx-label vx-eyebrow">
            Apache-2.0 · A Linux Foundation project
          </span>
          <h1 className="vx-display">The fastest columnar file format.</h1>
          <InstallTabs sparkVersion={sparkVersion} />
        </div>
        <div className={styles.mark}>
          <AsciiMark className={styles.markHost} />
        </div>
      </section>
      {/* Empty bands that the BenchmarkCard and the LogoBanner fill next. */}
      <div
        className={`${styles.band} ${styles.benchSlot}`}
        data-slot="benchmark-card"
      />
      <div
        className={`${styles.band} ${styles.logoSlot}`}
        data-slot="logo-banner"
      />
    </div>
  );
}
