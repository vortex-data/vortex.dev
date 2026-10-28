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

// Assertion thresholds. The first calibration (local `bun run start`,
// 2026-05-04) had every URL at perf 1.00 and set a flat 0.9 floor on every
// category. CI runners don't reproduce that for `/`. Across the 95 archived
// CI runs from 2026-08-04 to 2026-10-28:
//
//   /                  perf 0.69–1.00, median 0.90 · 45 of 95 below 0.9
//   /blog              perf never below 0.95
//   /blog/<seed>       perf never below 0.95
//   a11y · bp · seo    never below 0.9 on any URL
//
// All of the swing on `/` is Total Blocking Time. FCP, LCP and CLS scored
// 0.98 or better in every run, while TBT ranged from 0 to 2382 ms. The page's
// startup JS (React hydration plus the WebGL hero, which runs on the CPU
// because runners have no GPU) stretches into long tasks whenever the shared
// runner is busy. More runs don't fix it: the 0.9 floor sits on the median,
// so the median of 3 or 5 runs fails about as often as a single run.
//
// So on `/` the category score is advisory (`warn` still prints it in the
// log and the PR comment) and the metrics that hold steady on CI hard-fail
// instead: FCP, LCP and CLS at a 0.9 audit score. Speed Index follows TBT
// (correlation 0.89) and peaked at 1286 ms, just inside its 0.9 line at
// 1311 ms, so it gets a 2000 ms cap instead, about the same headroom over
// the worst run that LCP has under its 0.9 line. That leaves TBT (30% of the
// desktop score) as the only ungated part of the `/` score. Every other URL
// keeps the 0.9 performance floor; its pattern matches any non-root path, so
// a new URL gets the floor by default. Don't relax a threshold to mask a regression without
// a separate PR.
module.exports = {
  ci: {
    collect: {
      startServerCommand: "bun run start",
      startServerReadyPattern: "Ready",
      url: baseUrls,
      numberOfRuns: 1,
      settings: {
        preset: "desktop",
        throttlingMethod: "simulate",
        skipAudits: ["uses-http2"]
      }
    },
    assert: {
      // LHCI applies every entry whose pattern matches a URL's finalUrl.
      assertMatrix: [
        {
          matchingUrlPattern: ".*",
          assertions: {
            "categories:accessibility": ["error", { minScore: 0.9 }],
            "categories:best-practices": ["error", { minScore: 0.9 }],
            "categories:seo": ["error", { minScore: 0.9 }]
          }
        },
        {
          matchingUrlPattern: "^https?://[^/]+/$",
          assertions: {
            "categories:performance": ["warn", { minScore: 0.9 }],
            "first-contentful-paint": ["error", { minScore: 0.9 }],
            "largest-contentful-paint": ["error", { minScore: 0.9 }],
            "cumulative-layout-shift": ["error", { minScore: 0.9 }],
            "speed-index": ["error", { maxNumericValue: 2000 }]
          }
        },
        {
          matchingUrlPattern: "^https?://[^/]+/.",
          assertions: {
            "categories:performance": ["error", { minScore: 0.9 }]
          }
        }
      ]
    },
    upload: {
      target: "temporary-public-storage"
    }
  }
};
