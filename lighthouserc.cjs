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
// worst best-of-three values seen. They come from the CI runs on a preview,
// through the proxy, since CI moved there on 2026-11-03: seven passes of
// every page that day, one of them a failed attempt that a re-run replaced.
//
//            perf   FCP     LCP     Speed Index   TBT      CLS
//   /        1.00   302 ms  622 ms  1046 ms       0 ms     0
//   /blog    1.00   344 ms  666 ms  349 ms        0 ms     0
//   post     1.00   340 ms  692 ms  340 ms        0 ms     0
//   /bench   1.00   446 ms  701 ms  453 ms        0 ms     0
//   chart    1.00   382 ms  664 ms  612 ms        41 ms    0.011
//
// The homepage's Speed Index swings the most: its best of three runs is
// usually about 700 ms, but single runs reach 2219 ms, and in the failed
// attempt all three were slow (1409, 1046 and 1084 ms). Speed Index measures
// how fast the page looks complete, and the WebGL mark starts drawing once
// the page is idle, on the runner's CPU. On a local build, before the
// preview, every page's values were lower, and the homepage's Speed Index
// was at most 576 ms. A preview's first request is a cold start (805 ms to
// the first byte on bench), so the workflow requests each page once before
// Lighthouse does.
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
// 0.011), to catch a real regression but not a slow runner. The one
// exception is the homepage's Speed Index, capped at 2000 ms instead of
// 1000 ms. LCP keeps its 1000 ms cap, 1.4 times its worst. As more preview
// runs come in,
// recalibrate from the archived runs. Don't relax a threshold to mask a
// regression without a separate PR.
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertions({ speedIndex }) {
  return {
    "categories:performance": ["error", { minScore: 0.9 }],
    "categories:accessibility": ["error", { minScore: 1 }],
    "categories:best-practices": ["error", { minScore: 1 }],
    "categories:seo": ["error", { minScore: 1 }],
    "first-contentful-paint": ["error", { maxNumericValue: 700 }],
    "largest-contentful-paint": ["error", { maxNumericValue: 1000 }],
    "speed-index": ["error", { maxNumericValue: speedIndex }],
    "total-blocking-time": ["error", { maxNumericValue: 300 }],
    "cumulative-layout-shift": ["error", { maxNumericValue: 0.05 }]
  };
}

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
      // LHCI applies every entry whose pattern matches a URL, so the two
      // patterns split the homepage from the other pages.
      assertMatrix: [
        {
          matchingUrlPattern: `^${escapeRegExp(base)}/$`,
          assertions: assertions({ speedIndex: 2000 })
        },
        {
          matchingUrlPattern: `^${escapeRegExp(base)}/.`,
          assertions: assertions({ speedIndex: 1000 })
        }
      ]
    },
    // Reports stay on disk, in .lighthouseci/, and nothing goes to
    // Lighthouse's public report storage. CI keeps only the scores.
    upload: {
      target: "filesystem",
      outputDir: ".lighthouseci"
    }
  }
};
