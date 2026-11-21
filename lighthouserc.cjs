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
  faq: "/faq",
  bench: "/bench",
  chart: process.env.BENCH_CHART_PATH
    ? `/bench${process.env.BENCH_CHART_PATH}`
    : undefined,
  methodology: "/bench/methodology"
};
// LHCI_PAGE picks one page, as each of CI's Lighthouse jobs does; without
// it, every page.
const picked = process.env.LHCI_PAGE
  ? [process.env.LHCI_PAGE]
  : Object.keys(pages);
const targets = picked
  .filter((page) => pages[page])
  .map((page) => ({ page, url: `${base}${pages[page]}` }));

// Each page is audited as two devices. Desktop is Lighthouse's desktop
// preset. Mobile is Lighthouse's default device, a mid-range phone on a slow
// 4G network with a 4× CPU slowdown; its screen is set here in full, so that
// scripts/lighthouse-scores.mjs can check each report against its profile.
// LHCI_PROFILE picks one, as each CI job does; the default is desktop.
const profileSettings = {
  desktop: {
    preset: "desktop",
    formFactor: "desktop",
    screenEmulation: {
      mobile: false,
      width: 1350,
      height: 940,
      deviceScaleFactor: 1,
      disabled: false
    }
  },
  mobile: {
    formFactor: "mobile",
    screenEmulation: {
      mobile: true,
      width: 412,
      height: 823,
      deviceScaleFactor: 1.75,
      disabled: false
    }
  }
};
const profile = process.env.LHCI_PROFILE ?? "desktop";
if (!profileSettings[profile]) {
  throw new Error(`LHCI_PROFILE must be desktop or mobile, not ${profile}.`);
}

// Floors and caps. Each profile has defaults, and a page can override some
// of them, with a reason. LHCI asserts on the best of the runs for each value
// (its default `aggregationMethod: "optimistic"`), so each number below is
// checked against a page's best run.
//
// Desktop. The values come from the CI runs on a preview, through the proxy,
// since CI moved there on 2026-11-03: seven passes of every page that day,
// one of them a failed attempt that a re-run replaced. The worst best-of-three
// values were:
//
//            perf   FCP     LCP     Speed Index   TBT      CLS
//   /        1.00   302 ms  622 ms  1046 ms       0 ms     0
//   /blog    1.00   344 ms  666 ms  349 ms        0 ms     0
//   post     1.00   340 ms  692 ms  340 ms        0 ms     0
//   /bench   1.00   446 ms  701 ms  453 ms        0 ms     0
//   chart    1.00   382 ms  664 ms  612 ms        41 ms    0.011
//
// A preview's first request is a cold start (805 ms to the first byte on
// bench), so the workflow requests each page once before Lighthouse does.
//
// Accessibility and SEO were 1.00 in every run since the contrast fixes of
// 2026-10-30. Best practices was 0.96 in every run, from one audit only: off
// Vercel, the Vercel Analytics script is a 404 and logs a console error. The
// site's layout now leaves the script out there. On a preview, Vercel's
// Toolbar can fail two of its audits; `collect.settings` below blocks it.
//
// So the categories whose audits don't depend on timing are held at 1.00,
// and any new failing audit fails the check. Performance is held at 0.9, and
// each metric cap is about 1.5 to 2 times the worst value (CLS more, as
// bench's chart page sits at 0.011), to catch a real regression but not a
// slow runner.
//
// Mobile. The values come from ten runs of every page on a preview, in two
// CI runs on 2026-11-21. With three runs, a check is judged by the best of
// them, so the worst case is each page's third-worst value of the ten:
//
//            perf   FCP      LCP      Speed Index   TBT      CLS
//   /        0.95   1141 ms  1784 ms  2051 ms       245 ms   0
//   /blog    0.90   1145 ms  2817 ms  1154 ms       104 ms   0
//   post     0.91   1097 ms  3443 ms  1097 ms       95 ms    0
//   /bench   0.87   1129 ms  3023 ms  1137 ms       184 ms   0
//   chart    0.94   1126 ms  2061 ms  1851 ms       269 ms   0.006
//
// Single runs were slower: performance fell to 0.69 on the homepage and 0.75
// on /bench, and blocking time reached 1686 ms on the homepage. So the
// mobile performance floor is 0.8, and each metric cap is about 1.3 to 2
// times the worst value above. Accessibility and SEO were 1.00 in every run.
//
// Recalibrate from a baseline run (see "Baseline" in lighthouse.yml), and
// don't relax a value to mask a regression without a separate PR.
const policy = {
  desktop: {
    defaults: {
      performance: 0.9,
      accessibility: 1,
      "best-practices": 1,
      seo: 1,
      "first-contentful-paint": 700,
      "largest-contentful-paint": 1000,
      "speed-index": 1000,
      "total-blocking-time": 300,
      "cumulative-layout-shift": 0.05
    },
    pages: {
      home: {
        "speed-index": 2000,
        reason:
          "The homepage's Speed Index swings the most: its best of three runs is usually about 700 ms, but single runs reach 2219 ms, and in a failed attempt on 2026-11-03 all three were slow (1409, 1046 and 1084 ms). Speed Index measures how fast the page looks complete, and the WebGL mark starts drawing once the page is idle, on the runner's CPU."
      }
    }
  },
  mobile: {
    defaults: {
      performance: 0.8,
      accessibility: 1,
      "best-practices": 1,
      seo: 1,
      "first-contentful-paint": 1800,
      "largest-contentful-paint": 4500,
      "speed-index": 2000,
      "total-blocking-time": 500,
      "cumulative-layout-shift": 0.05
    },
    pages: {
      home: {
        "best-practices": 0.96,
        "speed-index": 3000,
        reason:
          "On a phone, Lighthouse's font-size audit fails when less than 60% of a page's text is at least 12px. The footer (.vx-footer) and the small labels (.vx-label-sm) are 11px. On 2026-11-21, 59.03% of the homepage's text was legible, and 21.54% of the chart page's, where the footer is most of the text. Every mobile run of both pages failed the audit, so best practices was 0.96. The footer stays at 11px on purpose: it is the design system's footer, and it matches the docs' footer. The WebGL mark makes the homepage's Speed Index the slowest: 2051 ms in the worst case of ten runs, and 2431 ms in one run."
      },
      chart: {
        "best-practices": 0.96,
        "speed-index": 3000,
        reason:
          "On a phone, Lighthouse's font-size audit fails when less than 60% of a page's text is at least 12px. The footer (.vx-footer) and the small labels (.vx-label-sm) are 11px. On 2026-11-21, 59.03% of the homepage's text was legible, and 21.54% of the chart page's, where the footer is most of the text. Every mobile run of both pages failed the audit, so best practices was 0.96. The footer stays at 11px on purpose: it is the design system's footer, and it matches the docs' footer. The chart draws after its data loads, so its Speed Index is 1851 ms in the worst case of ten runs."
      }
    }
  }
};

const categories = ["performance", "accessibility", "best-practices", "seo"];

/** The floors and caps of one page on one profile. */
function floorsFor(page, profileName) {
  const { defaults, pages: overrides } = policy[profileName];
  const { reason: _reason, ...override } = overrides[page] ?? {};
  return { ...defaults, ...override };
}

function assertions(floors) {
  return Object.fromEntries(
    Object.entries(floors).map(([key, value]) => [
      categories.includes(key) ? `categories:${key}` : key,
      [
        "error",
        categories.includes(key)
          ? { minScore: value }
          : { maxNumericValue: value }
      ]
    ])
  );
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Three runs: "Lighthouse and axe" is a required check, so one slow shared
// runner must not fail it. A real regression shows in every run and still
// fails; an outlier run does not. It can't cover a runner that is slow for
// the whole job: on 2026-10-30 all three passes of the blog post scored 0.74.
// A baseline sets LHCI_RUNS and LHCI_BASELINE, which collects more runs and
// asserts nothing.
const numberOfRuns = Number(process.env.LHCI_RUNS ?? 3);
const baseline = process.env.LHCI_BASELINE === "1";

module.exports = {
  pages,
  policy,
  floorsFor,
  profile,
  numberOfRuns,
  ci: {
    collect: {
      url: targets.map((target) => target.url),
      numberOfRuns,
      settings: {
        ...profileSettings[profile],
        throttlingMethod: "simulate",
        skipAudits: ["uses-http2"],
        // Vercel adds its Toolbar to previews only, from vercel.live, which
        // uses pusher.com. The proxy's `x-vercel-skip-toolbar` header does not
        // always keep it out, and the Toolbar can set a third-party cookie.
        // That fails the third-party-cookies and inspector-issues audits on
        // every page. On 2026-11-20, best practices fell to 0.78 on all five
        // pages of a preview in two attempts, and a later run of the same PR
        // scored 1.00. A local build scored 1.00 too. CI kept only category
        // scores then, so it did not record which audits failed. The Toolbar
        // is not part of the app and production never loads it, so the audit
        // blocks both hosts. Lighthouse ignores a blocked request in
        // errors-in-console.
        blockedUrlPatterns: ["*vercel.live*", "*pusher.com*"]
      }
    },
    // One entry per page, matching its URL exactly.
    ...(baseline
      ? {}
      : {
          assert: {
            assertMatrix: targets.map((target) => ({
              matchingUrlPattern: `^${escapeRegExp(target.url)}$`,
              assertions: assertions(floorsFor(target.page, profile))
            }))
          }
        }),
    // Reports stay on disk, in .lighthouseci/, and nothing goes to
    // Lighthouse's public report storage. CI keeps only the scores.
    upload: {
      target: "filesystem",
      outputDir: ".lighthouseci"
    }
  }
};
