import { withPlausibleProxy } from "next-plausible";

// Start Velite automatically with Next.js (recommended approach)
const isDev = process.argv.indexOf("dev") !== -1;
const isBuild = process.argv.indexOf("build") !== -1;
if (!process.env.VELITE_STARTED && (isDev || isBuild)) {
  process.env.VELITE_STARTED = "1";
  const { build } = await import("velite");
  await build({ watch: isDev, clean: !isDev });
}

// bench, the benchmark results site, is this app's routes under /bench
// (src/app/(bench)/bench). On its own host, bench.vortex.dev, it is served
// from the root: the rewrites below map that host's paths onto /bench, so
// every public bench URL stays as it was. Everywhere else (previews, local
// dev and the deployment's own URL) bench is at /bench. A `has` value is a
// regular expression matched against the host without its port. Next.js
// anchors it; the explicit anchors keep it exact wherever it is matched.
const BENCH_HOST = [{ type: "host", value: "^bench\\.vortex\\.dev$" }];
// The marketing site's own hosts, where /bench is not served (see rewrites).
const SITE_HOSTS = [{ type: "host", value: "^(www\\.)?vortex\\.dev$" }];

// MDXRenderer compiles velite-emitted JSX via `new Function(code)`, but it's
// a server component — the eval happens at build/SSR time on the server, so
// the browser never sees the dynamic code and CSP doesn't need 'unsafe-eval'.
//
// vercel.live (+ vercel.com / assets.vercel.com / wss://ws-us3.pusher.com) is
// the Vercel Live feedback toolbar, injected on preview deploys only. It's
// not loaded in production, so widening these directives doesn't broaden the
// prod attack surface — and a single static CSP is simpler than swapping
// headers per environment.
//
// bench's pages load the design system's web fonts from Google Fonts (see
// src/bench/lib/fonts.ts), so bench's policy adds that stylesheet and its font
// files. The marketing site self-hosts its fonts and keeps the narrower one.
function contentSecurityPolicy({ styleSrc = "", fontSrc = "" } = {}) {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' plausible.io va.vercel-scripts.com vercel.live",
    `style-src 'self' 'unsafe-inline' vercel.live${styleSrc}`,
    "img-src 'self' data: blob: vercel.live vercel.com",
    `font-src 'self' data: vercel.live assets.vercel.com${fontSrc}`,
    "connect-src 'self' plausible.io vitals.vercel-insights.com vercel.live wss://ws-us3.pusher.com",
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "frame-src 'self' vercel.live",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'"
  ].join("; ");
}
const csp = contentSecurityPolicy();
const benchCsp = contentSecurityPolicy({
  styleSrc: " https://fonts.googleapis.com",
  fontSrc: " https://fonts.gstatic.com"
});

// Cross-Origin-Opener-Policy keeps windows from other origins from holding a
// reference to this page. Production gets `same-origin`. Previews and local
// dev get `same-origin-allow-popups`, so the Vercel toolbar's sign-in popup can
// still report back to the page. Framing is already denied above
// (`frame-ancestors 'none'`, `X-Frame-Options: DENY`).
const crossOriginOpenerPolicy =
  process.env.VERCEL_ENV === "production"
    ? "same-origin"
    : "same-origin-allow-popups";

// next-plausible v4 requires a `src` URL for the v2 Plausible script. When
// the env var is unset (e.g. local dev), skip the proxy wrapper entirely —
// `<PlausibleProvider>` in the app tree is also gated on the same env var.
const plausibleScriptSrc = process.env.NEXT_PUBLIC_PLAUSIBLE_SCRIPT_SRC;
const wrapWithPlausible = plausibleScriptSrc
  ? withPlausibleProxy({ src: plausibleScriptSrc })
  : (config) => config;

const nextConfig = wrapWithPlausible({
  turbopack: {
    root: import.meta.dirname
  },
  images: {
    formats: ["image/avif", "image/webp"]
  },
  // Embed the built commit, so bench's /api/health and footer name the
  // deployed build however the runtime is configured. Vercel sets the
  // variable during its builds.
  env: {
    VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown"
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload"
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin"
          },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), gyroscope=(), payment=(), usb=(), magnetometer=(), accelerometer=()"
          },
          { key: "Content-Security-Policy", value: csp },
          { key: "Cross-Origin-Opener-Policy", value: crossOriginOpenerPolicy },
          // Only vortex.dev and its subdomains may embed this site's
          // resources. Link unfurlers fetch from a server, which this does not
          // affect. The favicon is the exception below.
          { key: "Cross-Origin-Resource-Policy", value: "same-site" }
        ]
      },
      // bench's policy, in both of its URL forms. Headers match the path as
      // requested, before the rewrites, and a later rule overrides the
      // header above.
      {
        source: "/bench/:path*",
        missing: SITE_HOSTS,
        headers: [{ key: "Content-Security-Policy", value: benchCsp }]
      },
      {
        source: "/(.*)",
        has: BENCH_HOST,
        headers: [{ key: "Content-Security-Policy", value: benchCsp }]
      },
      {
        // The RSS feed advertises the favicon, and feed readers that run in
        // a browser or an extension load it from another site. This later
        // rule overrides the header above for this path.
        source: "/favicon.ico",
        missing: BENCH_HOST,
        headers: [
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" }
        ]
      }
    ];
  },
  async redirects() {
    // The marketing site's short links. bench's host has none.
    return [
      {
        source: "/code",
        missing: BENCH_HOST,
        destination: "https://github.com/vortex-data/vortex",
        permanent: true
      },
      {
        source: "/slack",
        missing: BENCH_HOST,
        destination:
          "https://join.slack.com/t/vortex-data/shared_invite/zt-3i4ian4du-mmm~~g9jdz2U_B0dA8CIEg",
        permanent: false
      }
    ];
  },
  async rewrites() {
    return {
      // Before the filesystem, so a bench path never reaches a site page or
      // file of the same name. Each rule sees the path the rules before it
      // rewrote, so the order matters: no rule may match a path that an
      // earlier one produced.
      beforeFiles: [
        // bench is not served under the marketing site's own hosts: those
        // paths 404 there, as before, and bench.vortex.dev stays its only
        // public address.
        {
          source: "/bench/:path*",
          has: SITE_HOSTS,
          destination: "/not-found"
        },
        {
          // Every path on bench's host but `/`, except Next.js's own assets
          // and the cron's /bench/api/health (vercel.json), which Vercel may
          // call on any of the deployment's hosts.
          source: "/:path((?!_next/|bench/api/health$).+)",
          has: BENCH_HOST,
          destination: "/bench/:path"
        },
        { source: "/", has: BENCH_HOST, destination: "/bench" },
        // The site's Open Graph images at their own URLs. Next.js names a
        // metadata image route in a route group with a suffix, a hash of its
        // parent path (getMetadataRouteSuffix in next/dist/lib/metadata), so
        // `opengraph-image.tsx` in src/app/(site) is served at
        // `/opengraph-image-<hash>`, and the pages' og:image tags name that.
        // These keep the plain URLs, which the posts' JSON-LD and links
        // already shared name, serving the same images.
        ...[
          ["/opengraph-image", "/(site)"],
          ["/blog/opengraph-image", "/(site)/blog"],
          ["/blog/:slug/opengraph-image", "/(site)/blog/[slug]"]
        ].map(([source, parent]) => ({
          source,
          missing: BENCH_HOST,
          destination: `${source}-${metadataRouteSuffix(parent)}`
        }))
      ]
    };
  }
});

/** Next.js's suffix for a metadata route under `parent`: the first six base-36 digits of its djb2 hash. */
function metadataRouteSuffix(parent) {
  let hash = 5381;
  for (let i = 0; i < parent.length; i++) {
    hash = ((hash << 5) + hash + parent.charCodeAt(i)) & 0xffffffff;
  }
  return (hash >>> 0).toString(36).slice(0, 6);
}

export default nextConfig;
