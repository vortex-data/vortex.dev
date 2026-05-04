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

// Assertion thresholds. Calibrated against an actual local `bun run start`
// baseline on 2026-05-04 with the deps as of branch time:
//
//   /                              perf 1.00 · a11y 1.00 · bp 0.96 · seo 1.00
//   /blog                          perf 1.00 · a11y 1.00 · bp 0.96 · seo 1.00
//   /blog/<seed>                   perf 1.00 · a11y 0.96 · bp 0.96 · seo 1.00
//
// The WebGL hero on `/` doesn't drag perf down under desktop simulation —
// every category clears 0.9 with comfortable headroom across all three URLs.
// A flat 0.9 floor is what willmanning uses; a per-URL matrix would be dead
// scaffolding here. Tighten via a separate PR if a category drifts up enough
// that 0.9 stops catching real regressions; don't relax to mask a regression
// without a separate PR.
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
      assertions: {
        "categories:performance": ["error", { minScore: 0.9 }],
        "categories:accessibility": ["error", { minScore: 0.9 }],
        "categories:best-practices": ["error", { minScore: 0.9 }],
        "categories:seo": ["error", { minScore: 0.9 }]
      }
    },
    upload: {
      target: "temporary-public-storage"
    }
  }
};
