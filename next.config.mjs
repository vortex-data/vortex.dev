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
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' plausible.io",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' plausible.io vitals.vercel-insights.com",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join("; ");

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
            value: "camera=(), microphone=(), geolocation=(), payment=()"
          },
          { key: "Content-Security-Policy", value: csp }
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
