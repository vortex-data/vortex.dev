import { withPlausibleProxy } from "next-plausible";

// Start Velite automatically with Next.js (recommended approach)
const isDev = process.argv.indexOf("dev") !== -1;
const isBuild = process.argv.indexOf("build") !== -1;
if (!process.env.VELITE_STARTED && (isDev || isBuild)) {
  process.env.VELITE_STARTED = "1";
  const { build } = await import("velite");
  await build({ watch: isDev, clean: !isDev });
}

// MDXRenderer compiles velite-emitted JSX via `new Function(code)`, but it's
// a server component — the eval happens at build/SSR time on the server, so
// the browser never sees the dynamic code and CSP doesn't need 'unsafe-eval'.
//
// vercel.live (+ vercel.com / assets.vercel.com / wss://ws-us3.pusher.com) is
// the Vercel Live feedback toolbar, injected on preview deploys only. It's
// not loaded in production, so widening these directives doesn't broaden the
// prod attack surface — and a single static CSP is simpler than swapping
// headers per environment.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' plausible.io va.vercel-scripts.com vercel.live",
  "style-src 'self' 'unsafe-inline' vercel.live",
  "img-src 'self' data: blob: vercel.live vercel.com",
  "font-src 'self' data: vercel.live assets.vercel.com",
  "connect-src 'self' plausible.io vitals.vercel-insights.com vercel.live wss://ws-us3.pusher.com",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "frame-src 'self' vercel.live",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'"
].join("; ");

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
      {
        // The RSS feed advertises the favicon, and feed readers that run in
        // a browser or an extension load it from another site. This later
        // rule overrides the header above for this path.
        source: "/favicon.ico",
        headers: [
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" }
        ]
      }
    ];
  },
  async redirects() {
    return [
      {
        source: "/code",
        destination: "https://github.com/vortex-data/vortex",
        permanent: true
      },
      {
        source: "/slack",
        destination:
          "https://join.slack.com/t/vortex-data/shared_invite/zt-3i4ian4du-mmm~~g9jdz2U_B0dA8CIEg",
        permanent: false
      }
    ];
  }
});

export default nextConfig;
