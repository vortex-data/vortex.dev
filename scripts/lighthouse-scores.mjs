// Check a Lighthouse job's reports, and keep only their scores.
//
//   node scripts/lighthouse-scores.mjs keep <out-dir>
//   node scripts/lighthouse-scores.mjs summary <scores.json …>
//
// `keep` reads .lighthouseci/lhr-*.json, which the Lighthouse CI step wrote
// for the page and profile that LHCI_PAGE and LHCI_PROFILE name (see
// lighthouserc.cjs). It fails if a report is not a valid audit of that page
// on that device: a redirect, a document that is not HTTP 200, a runtime
// error, the wrong device settings, or the wrong number of runs. Lighthouse
// scores an error page as it scores any page, so a broken preview could
// otherwise pass. For each report it writes the category scores, the metric
// values, and the IDs of the scored audits below 1, and it prints the IDs.
// These are Lighthouse's own names and numbers, not page content: the full
// reports, with screenshots of the protected preview, stay on the runner.
//
// `summary` prints a Markdown table of the kept scores, by page and profile,
// to calibrate the floors in lighthouserc.cjs.
//
// It uses only Node's built-in modules, because the Lighthouse jobs run no
// `bun install`.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const METRICS = [
  "first-contentful-paint",
  "largest-contentful-paint",
  "speed-index",
  "total-blocking-time",
  "cumulative-layout-shift"
];
const LABELS = {
  "first-contentful-paint": "FCP ms",
  "largest-contentful-paint": "LCP ms",
  "speed-index": "Speed Index ms",
  "total-blocking-time": "TBT ms",
  "cumulative-layout-shift": "CLS"
};
const CATEGORIES = ["performance", "accessibility", "best-practices", "seo"];

/** The ways `report` is not an audit of `url` on `profile`. */
export function reportProblems(report, { url, profile }) {
  const problems = [];
  if (report.runtimeError) {
    problems.push(
      `Lighthouse failed: ${report.runtimeError.code ?? "unknown error"}.`
    );
  }
  if (report.requestedUrl !== url) {
    problems.push(`The report is of ${report.requestedUrl}, not ${url}.`);
  }
  const finalUrl = report.mainDocumentUrl ?? report.finalUrl;
  if (finalUrl !== url) {
    problems.push(`${url} redirected to ${finalUrl}.`);
  }
  const settings = report.configSettings ?? {};
  if (
    settings.formFactor !== profile ||
    settings.screenEmulation?.mobile !== (profile === "mobile") ||
    settings.screenEmulation?.disabled !== false
  ) {
    problems.push(`The report does not use the ${profile} device settings.`);
  }
  const documents = (
    report.audits?.["network-requests"]?.details?.items ?? []
  ).filter((item) => item.resourceType === "Document" && item.url === url);
  if (documents.length === 0) {
    problems.push(`The report has no request for the document ${url}.`);
  } else if (documents.some((item) => item.statusCode !== 200)) {
    problems.push(
      `The document returned HTTP ${documents.map((item) => item.statusCode).join(", ")}, not 200.`
    );
  }
  for (const category of CATEGORIES) {
    if (typeof report.categories?.[category]?.score !== "number") {
      problems.push(`The report has no ${category} score.`);
    }
  }
  return problems;
}

/** The part of a report that leaves the runner. */
export function keptScores(report, { page, profile }) {
  return {
    page,
    profile,
    finalUrl: report.finalUrl,
    categories: Object.fromEntries(
      CATEGORIES.map((category) => [
        category,
        { score: report.categories[category].score }
      ])
    ),
    metrics: Object.fromEntries(
      METRICS.map((metric) => [
        metric,
        report.audits?.[metric]?.numericValue ?? null
      ])
    ),
    failedAudits: Object.fromEntries(
      CATEGORIES.map((category) => [
        category,
        report.categories[category].auditRefs
          .filter((ref) => ref.weight > 0)
          .map((ref) => ref.id)
          .filter((id) => {
            const score = report.audits?.[id]?.score;
            return score !== null && score !== undefined && score < 1;
          })
      ])
    )
  };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function format(metric, value) {
  if (metric === "cumulative-layout-shift") return value.toFixed(3);
  return `${Math.round(value)}`;
}

/** A Markdown table of kept scores: one row for each page and profile. */
export function summaryTable(kept) {
  const groups = new Map();
  for (const scores of kept) {
    const key = `${scores.page} ${scores.profile}`;
    groups.set(key, [...(groups.get(key) ?? []), scores]);
  }
  const header = [
    "| Page | Profile | Runs | Perf (min / median) | A11y, BP, SEO (min) | " +
      METRICS.map((metric) => `${LABELS[metric]} (median / max)`).join(" | ") +
      " |",
    `|---|---|---:|---:|---:|${METRICS.map(() => "---:").join("|")}|`
  ];
  const rows = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, runs]) => {
      const score = (category) =>
        runs.map((run) => run.categories[category].score);
      const perf = score("performance");
      const others = ["accessibility", "best-practices", "seo"]
        .map((category) => Math.min(...score(category)).toFixed(2))
        .join(", ");
      const metrics = METRICS.map((metric) => {
        const values = runs
          .map((run) => run.metrics[metric])
          .filter((value) => typeof value === "number");
        if (values.length === 0) return "–";
        return `${format(metric, median(values))} / ${format(metric, Math.max(...values))}`;
      });
      return `| ${runs[0].page} | ${runs[0].profile} | ${runs.length} | ${Math.min(...perf).toFixed(2)} / ${median(perf).toFixed(2)} | ${others} | ${metrics.join(" | ")} |`;
    });
  return [...header, ...rows].join("\n");
}

function keep(outDir) {
  const config = createRequire(import.meta.url)("../lighthouserc.cjs");
  const page = process.env.LHCI_PAGE;
  const [url] = config.ci.collect.url;
  if (!page || config.ci.collect.url.length !== 1) {
    throw new Error("Set LHCI_PAGE to the one page this job audited.");
  }
  const { profile, numberOfRuns } = config;
  const files = readdirSync(".lighthouseci")
    .filter((name) => /^lhr-.*\.json$/.test(name))
    .map((name) => join(".lighthouseci", name));
  const problems = [];
  if (files.length !== numberOfRuns) {
    problems.push(
      `Expected ${numberOfRuns} reports of ${url}, found ${files.length}.`
    );
  }
  mkdirSync(outDir, { recursive: true });
  for (const file of files) {
    const report = JSON.parse(readFileSync(file, "utf8"));
    const found = reportProblems(report, { url, profile });
    problems.push(...found.map((problem) => `${basename(file)}: ${problem}`));
    if (found.length > 0) continue;
    const scores = keptScores(report, { page, profile });
    writeFileSync(join(outDir, basename(file)), JSON.stringify(scores));
    const failed = Object.entries(scores.failedAudits)
      .filter(([, ids]) => ids.length > 0)
      .map(([category, ids]) => `${category} [${ids.join(", ")}]`);
    console.log(
      `${url} (${profile}): ${failed.length ? failed.join("; ") : "no failed audits"}`
    );
  }
  for (const problem of problems) console.log(`::error::${problem}`);
  if (problems.length > 0) process.exitCode = 1;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "keep" && rest.length === 1) {
    keep(rest[0]);
  } else if (command === "summary") {
    const kept = rest.map((file) => JSON.parse(readFileSync(file, "utf8")));
    console.log(summaryTable(kept));
  } else {
    console.error(
      "usage: node scripts/lighthouse-scores.mjs keep <out-dir> | summary <scores.json …>"
    );
    process.exit(2);
  }
}
