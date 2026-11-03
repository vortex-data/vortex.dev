import type { Metadata } from "next";
import { AsciiMark } from "@/components/ascii-mark";
import { InstallTabs } from "@/components/install-tabs";
import { LogoBanner } from "@/components/logo-banner";
import { ResultsTable } from "@/components/results-table";
import { getBenchSummary } from "@/lib/bench-summary";
import { homeJsonLd, jsonLdScript } from "@/lib/llms";
import { getSparkVersion } from "@/lib/maven";
import styles from "./page.module.css";

const TITLE = "Vortex | The fastest columnar file format";
const DESCRIPTION =
  "Vortex is a columnar file format for fast scans and fast random access, with Rust, Python, DuckDB, DataFusion, and Spark support. An Apache-2.0 project of the Linux Foundation.";

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
 * The design system's Home card: the ASCII mark fills the first screen, with
 * the headline and its standfirst top left, the Eyebrow top right, the
 * InstallTabs bottom left and the results table bottom right. The LogoBanner
 * sits below the fold. Without WebGL or scripts the mark goes, and the words
 * and the table share one compact screen (page.module.css). The Spark version
 * and the benchmark figures are read at build time and again at most once a
 * day, so the page stays static. Without the figures the page leaves the
 * table out. The page carries the project's structured data (`homeJsonLd`).
 */
export default async function Home() {
  const [sparkVersion, bench] = await Promise.all([
    getSparkVersion(),
    getBenchSummary()
  ]);
  return (
    <div className={styles.home}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(homeJsonLd()) }}
      />
      <section className={styles.hero}>
        <span className={`vx-label vx-eyebrow ${styles.eyebrow}`}>
          Apache-2.0, a Linux Foundation project
        </span>
        <div className={styles.head}>
          <h1 className="vx-display-mono">
            {/* "pick three." is the second line, in every browser: Safari's
                text-wrap: pretty would otherwise rebalance it. */}
            Fast, small, open:{" "}
            <span className={styles.second}>pick three.</span>
          </h1>
          <p>
            Vortex is an open-source columnar file format for fast scans, random
            access, and compression.
          </p>
        </div>
        <div className={styles.install}>
          <InstallTabs sparkVersion={sparkVersion} />
        </div>
        {bench && (
          <div className={styles.results}>
            <ResultsTable panels={bench.panels} readAt={bench.readAt} />
          </div>
        )}
        <div className={styles.mark}>
          <AsciiMark className={styles.markHost} />
        </div>
      </section>
      <LogoBanner className={styles.band} />
    </div>
  );
}
