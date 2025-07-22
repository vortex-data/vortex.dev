import type { NextConfig } from "next";
import { withPlausibleProxy } from "next-plausible";

const nextConfig: NextConfig = withPlausibleProxy()({
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
        source: "/go",
        destination: "https://join.slack.com/t/spiraldb/shared_invite/zt-382vtcz8y-Fe5YEL2_zShwSCgNRnwktQ",
        permanent: false
      }
    ];
  }
});

export default nextConfig;
