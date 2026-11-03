// Lighthouse CI config for both sites. CI audits the pull request's Vercel
// preview, where bench has its database, through scripts/preview-proxy.mjs
// (see .github/workflows/lighthouse.yml):
//
//   BASE_URL          where the app answers: the proxy in CI, or a server
//                     you started, such as `bun run start` with bench's
//                     BENCH_DB_* variables (default http://localhost:3000)
//   BENCH_CHART_PATH  optional: one of bench's chart pages, /chart/<slug>
//
// JS instead of JSON so the URL list can be discovered at run time from the
// velite blog source — hardcoding a slug would break Lighthouse the day that
// post is renamed or unpublished. Frontmatter is parsed with a minimal regex
// (no gray-matter dep) since we only care about `published:` and `date:`.

const fs = require("node:fs");
const path = require("node:path");

const BLOG_DIR = path.join(__dirname, "src", "content", "blog");

function parseMinimalFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm = {};
  for (const line of match[1].split("\n")) {
    const m = line.match(/^([a-zA-Z][a-zA-Z0-9_-]*):\s*(.*?)\s*$/);
    if (!m) continue;
    fm[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return fm;
}

function pickSeedSlug() {
  let entries;
  try {
    entries = fs.readdirSync(BLOG_DIR);
  } catch {
    return null;
  }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.endsWith(".mdx")) continue;
    const slug = entry.replace(/\.mdx$/, "");
    const raw = fs.readFileSync(path.join(BLOG_DIR, entry), "utf8");
    const fm = parseMinimalFrontmatter(raw);
    if (fm.published === "false") continue;
    if (!fm.date) continue;
    candidates.push({ slug, date: fm.date });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (a.date < b.date ? 1 : -1));
  return candidates[0].slug;
}

const base = (process.env.BASE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  ""
);
// The pages to audit, by the name CI's matrix gives each one. bench is under
// `/bench`, as a preview and `bun run start` serve it.
const seed = pickSeedSlug();
const pages = {
  home: "/",
  blog: "/blog",
  post: seed ? `/blog/${seed}` : undefined,
  bench: "/bench",
  chart: process.env.BENCH_CHART_PATH
    ? `/bench${process.env.BENCH_CHART_PATH}`
    : undefined
};
// LHCI_PAGE picks one page, as each of CI's Lighthouse jobs does; without
// it, every page.
const picked = process.env.LHCI_PAGE
  ? [pages[process.env.LHCI_PAGE]]
  : Object.values(pages);
const urls = picked.filter(Boolean).map((p) => `${base}${p}`);

// Assertion thresholds. LHCI asserts on the best of the three runs for each
// value (its default `aggregationMethod: "optimistic"`), so these are the
// worst best-of-three values seen. The site's rows come from the 62 CI runs
// from 2026-10-30 to 2026-11-03, on a local build; the homepage changed on
// 2026-11-03 (the mark first, one results table), and 10 of the runs have
// the new one. bench's come from its first CI run on a preview, through the
// proxy, on 2026-11-03.
//
//            perf   FCP     LCP     Speed Index   TBT      CLS
//   /        1.00   252 ms  602 ms  576 ms        0 ms     0
//   /blog    1.00   256 ms  646 ms  256 ms        0.5 ms   0.00001
//   post     0.74   275 ms  660 ms  275 ms        736 ms   0.00001
//   /bench   1.00   307 ms  561 ms  636 ms        0 ms     0.0001
//   chart    1.00   387 ms  560 ms  574 ms        8 ms     0.011
//
// The post's 0.74 is one run, on 2026-10-30, slow in all three passes; in
// every other run it scored 1.00. The old homepage swung with the shared
// runner's load (perf down to 0.70, TBT up to 983 ms), because the WebGL
// mark runs on the CPU there, so its category score was only a warning. The
// new one has not swung in 30 passes. A preview's first request is a cold
// start (805 ms to the first byte on bench), so the workflow requests each
// page once before Lighthouse does.
//
// Accessibility and SEO were 1.00 in every run since the contrast fixes of
// 2026-10-30. Best practices was 0.96 in every run, from one audit only: off
// Vercel, the Vercel Analytics script is a 404 and logs a console error. The
// site's layout now leaves the script out there.
//
// So every URL gets one bar: performance at 0.9; accessibility, best
// practices and SEO at 1.00, since their audits don't depend on timing and
// any new failing audit should fail the check; and metric caps about 1.5 to
// 2 times the worst value above (CLS more, as bench's chart page sits at
// 0.011), to catch a real regression but not a slow runner. The site's rows
// were measured on a local build, not a preview: if the preview runs differ,
// recalibrate from the archived runs. Don't relax a threshold to mask a
// regression without a separate PR.
module.exports = {
  pages,
  ci: {
    collect: {
      url: urls,
      // "Lighthouse and axe" is a required check, so one slow shared runner
      // must not fail it. With several runs, LHCI asserts on the best one
      // (its default `aggregationMethod: "optimistic"`): a real regression
      // shows in every run and still fails, an outlier run does not. It
      // can't cover a runner that is slow for the whole job: on 2026-10-30
      // all three passes of the blog post scored 0.74.
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
        "categories:seo": ["error", { minScore: 1 }],
        "first-contentful-paint": ["error", { maxNumericValue: 500 }],
        "largest-contentful-paint": ["error", { maxNumericValue: 1000 }],
        "speed-index": ["error", { maxNumericValue: 1000 }],
        "total-blocking-time": ["error", { maxNumericValue: 300 }],
        "cumulative-layout-shift": ["error", { maxNumericValue: 0.05 }]
      }
    },
    upload: {
      target: "temporary-public-storage"
    }
  }
};
