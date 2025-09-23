import { withPlausibleProxy } from "next-plausible";

// Start Velite automatically with Next.js (recommended approach)
const isDev = process.argv.indexOf("dev") !== -1;
const isBuild = process.argv.indexOf("build") !== -1;
if (!process.env.VELITE_STARTED && (isDev || isBuild)) {
  process.env.VELITE_STARTED = "1";
  const { build } = await import("velite");
  await build({ watch: isDev, clean: !isDev });
}

const nextConfig = withPlausibleProxy()({
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Content-Type-Options",
            value: "nosniff"
          },
          {
            key: "X-Frame-Options",
            value: "DENY"
          },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' plausible.io; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' plausible.io vitals.vercel-insights.com; worker-src 'self' blob:; child-src 'self' blob:;"
          }
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
          "https://join.slack.com/t/spiraldb/shared_invite/zt-382vtcz8y-Fe5YEL2_zShwSCgNRnwktQ",
        permanent: false
      }
    ];
  }
});

export default nextConfig;
