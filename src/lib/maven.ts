// Maven Central's own metadata for the artifact. Its search API
// (search.maven.org/solrsearch) no longer indexes dev.vortex, so it finds
// nothing.
const METADATA_URL =
  "https://repo1.maven.org/maven2/dev/vortex/vortex-spark_2.13/maven-metadata.xml";
const DAY_SECONDS = 86400;
const TIMEOUT_MS = 5000;
// A release is digits and dots only, so a snapshot or a stray character can
// never reach the install command.
const VERSION = /^\d+(\.\d+)+$/;

/**
 * The latest release of `dev.vortex:vortex-spark_2.13`, for the homepage's
 * Spark install command. It is read at build time and again at most once a
 * day (ISR). Any failure (a timeout, an error status, metadata without a
 * release) gives `null`, and the command then shows `<latest>`. `fetchImpl`
 * is for tests.
 */
export async function getSparkVersion(
  fetchImpl: typeof fetch = fetch
): Promise<string | null> {
  try {
    const res = await fetchImpl(METADATA_URL, {
      next: { revalidate: DAY_SECONDS },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!res.ok) return null;
    const body = await res.text();
    const release = body.match(/<release>([^<]*)<\/release>/)?.[1]?.trim();
    return release && VERSION.test(release) ? release : null;
  } catch {
    return null;
  }
}
