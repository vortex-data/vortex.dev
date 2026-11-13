/** bench's public address, which production's links name. */
const BENCH_ORIGIN = "https://bench.vortex.dev";

/**
 * A link from the site to a bench page (`""` or `/` for the landing page,
 * `/methodology`, `/chart/{slug}`, …). Production links to bench.vortex.dev,
 * where bench is served from the root. Every other deployment (a preview, a
 * local build) serves bench under `/bench` on its own host, so its links stay
 * on that deployment rather than leaving for production. `next.config.mjs`
 * embeds `VERCEL_ENV` at build time, so a client component agrees with the
 * server render.
 */
export function benchHref(
  path = "",
  vercelEnv: string | undefined = process.env.VERCEL_ENV
): string {
  if (path !== "" && !path.startsWith("/")) {
    throw new Error(`benchHref takes a root-relative path, not ${path}`);
  }
  if (vercelEnv === "production") {
    return `${BENCH_ORIGIN}${path}`;
  }
  return path === "" || path === "/" ? "/bench" : `/bench${path}`;
}
