// Lighthouse CI config. JS instead of JSON so the URL list can be discovered
// at run time from the velite blog source — hardcoding a slug would break
// Lighthouse the day that post is renamed or unpublished.
//
// Frontmatter is parsed with a minimal regex (no gray-matter dep) since we
// only care about `published:` and `date:`. Keeping this file self-contained
// means it works the same locally (`bun run lighthouse`) and in CI without
// any install-order concerns.

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

const baseUrls = ["http://localhost:3000/", "http://localhost:3000/blog"];
const seed = pickSeedSlug();
if (seed) baseUrls.push(`http://localhost:3000/blog/${seed}`);

// Assertion thresholds, from the reports of the 62 CI runs from 2026-10-30
// to 2026-11-03. LHCI asserts on the best of the three runs for each value
// (its default `aggregationMethod: "optimistic"`), so these are the worst
// best-of-three values seen. The homepage changed on 2026-11-03 (the mark
// first, one results table); 10 of the runs have the new one.
//
//            perf   FCP     LCP     Speed Index   TBT      CLS
//   /        1.00   252 ms  602 ms  576 ms        0 ms     0
//   /blog    1.00   256 ms  646 ms  256 ms        0.5 ms   0.00001
//   post     0.74   275 ms  660 ms  275 ms        736 ms   0.00001
//
// The post's 0.74 is one run, on 2026-10-30, slow in all three passes; in
// every other run it scored 1.00. The old homepage swung with the shared
// runner's load (perf down to 0.70, TBT up to 983 ms), because the WebGL
// mark runs on the CPU there, so its category score was only a warning. The
// new one has not swung in 30 passes.
//
// Accessibility and SEO were 1.00 in every run since the contrast fixes of
// 2026-10-30. Best practices was 0.96 in every run, from one audit only: off
// Vercel, the Vercel Analytics script is a 404 and logs a console error. The
// site's layout now leaves the script out there.
//
// So every URL gets one bar: performance at 0.9; accessibility, best
// practices and SEO at 1.00, since their audits don't depend on timing and
// any new failing audit should fail the check; and metric caps about 1.5 to
// 2 times the worst value above, to catch a real regression but not a slow
// runner. If `/` starts to swing again, read the archived runs before
// relaxing anything, and don't relax a threshold to mask a regression
// without a separate PR.
module.exports = {
  ci: {
    collect: {
      startServerCommand: "bun run start",
      startServerReadyPattern: "Ready",
      url: baseUrls,
      // "Lighthouse audit" is a required check, so one slow shared runner
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
        "cumulative-layout-shift": ["error", { maxNumericValue: 0.01 }]
      }
    },
    upload: {
      target: "temporary-public-storage"
    }
  }
};
