// Lighthouse CI config for bench. bench needs its database to render, so CI
// audits it on the pull request's Vercel preview, through
// scripts/preview-proxy.mjs (see .github/workflows/lighthouse.yml), not on a
// local build as lighthouserc.cjs does for the site.
//
//   BENCH_URL         where bench starts, without a trailing slash:
//                     http://127.0.0.1:<port>/bench through the proxy
//   BENCH_CHART_PATH  optional: one chart page, such as /chart/<slug>
//
// Thresholds: see the comment above `assert`.

const base = process.env.BENCH_URL?.replace(/\/$/, "");
if (!base) throw new Error("lighthouserc.bench.cjs: set BENCH_URL");

// `/bench` on a preview, `/` on bench's own host.
const urls = [new URL(base).pathname === "/" ? `${base}/` : base];
if (process.env.BENCH_CHART_PATH)
  urls.push(base + process.env.BENCH_CHART_PATH);

// Thresholds: the site's category bars (lighthouserc.cjs), without its
// metric caps until CI has runs to set them from. Through the proxy, from a
// local machine, against production on 2026-11-03, three runs of each page
// scored 0.99 or 1.00 in every category. Don't relax a threshold to mask a
// regression.
module.exports = {
  ci: {
    collect: {
      url: urls,
      numberOfRuns: 3,
      settings: {
        preset: "desktop",
        throttlingMethod: "simulate",
        skipAudits: ["uses-http2"]
      }
    },
    assert: {
      assertions: {
        "categories:performance": ["error", { minScore: 0.9 }],
        "categories:accessibility": ["error", { minScore: 1 }],
        "categories:best-practices": ["error", { minScore: 1 }],
        "categories:seo": ["error", { minScore: 1 }]
      }
    },
    upload: {
      target: "temporary-public-storage"
    }
  }
};
