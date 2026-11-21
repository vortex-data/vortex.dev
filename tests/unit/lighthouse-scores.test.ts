import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import {
  keptScores,
  METRICS,
  reportProblems,
  summaryTable
} from "../../scripts/lighthouse-scores.mjs";

const url = "http://127.0.0.1:3201/blog";
const categories = ["performance", "accessibility", "best-practices", "seo"];

// The parts of a Lighthouse 12 report that the checks read.
function report(overrides: Record<string, unknown> = {}) {
  return {
    requestedUrl: url,
    finalUrl: url,
    mainDocumentUrl: url,
    configSettings: {
      formFactor: "mobile",
      screenEmulation: { mobile: true, disabled: false }
    },
    categories: Object.fromEntries(
      categories.map((category) => [
        category,
        {
          score: category === "performance" ? 0.92 : 1,
          auditRefs: [
            { id: `${category}-audit`, weight: 1 },
            { id: `${category}-unscored`, weight: 0 }
          ]
        }
      ])
    ),
    audits: {
      "network-requests": {
        details: {
          items: [
            { resourceType: "Document", url, statusCode: 200 },
            { resourceType: "Script", url: `${url}.js`, statusCode: 404 }
          ]
        }
      },
      "performance-audit": { score: 0.5 },
      "performance-unscored": { score: 0 },
      "accessibility-audit": { score: 1 },
      "best-practices-audit": { score: null },
      "seo-audit": { score: 1 },
      ...Object.fromEntries(
        METRICS.map((metric, index) => [metric, { numericValue: index + 0.5 }])
      )
    },
    ...overrides
  };
}

describe("the Lighthouse report checks", () => {
  const expected = { url, profile: "mobile" };

  it("accept an audit of the page on its profile", () => {
    assert.deepEqual(reportProblems(report(), expected), []);
  });

  it("reject a redirect, a runtime error, and another page", () => {
    assert.equal(
      reportProblems(report({ mainDocumentUrl: `${url}/` }), expected).length,
      1
    );
    assert.equal(
      reportProblems(report({ runtimeError: { code: "NO_FCP" } }), expected)
        .length,
      1
    );
    assert.equal(
      reportProblems(
        report({ requestedUrl: "http://127.0.0.1:3201/" }),
        expected
      ).length,
      1
    );
  });

  it("reject the other profile's device settings", () => {
    assert.equal(
      reportProblems(report(), { url, profile: "desktop" }).length,
      1
    );
    assert.equal(
      reportProblems(
        report({
          configSettings: {
            formFactor: "mobile",
            screenEmulation: { mobile: true, disabled: true }
          }
        }),
        expected
      ).length,
      1
    );
  });

  it("reject a document that is not HTTP 200, or no document", () => {
    const withDocument = (items: unknown[]) =>
      report({
        audits: {
          ...report().audits,
          "network-requests": { details: { items } }
        }
      });
    assert.equal(
      reportProblems(
        withDocument([{ resourceType: "Document", url, statusCode: 404 }]),
        expected
      ).length,
      1
    );
    assert.equal(reportProblems(withDocument([]), expected).length, 1);
  });

  it("reject a report without a category score", () => {
    const broken = report();
    const seo = (broken.categories as Record<string, { score: unknown }>).seo;
    assert.ok(seo);
    seo.score = null;
    assert.equal(reportProblems(broken, expected).length, 1);
  });
});

describe("the kept scores", () => {
  const kept = keptScores(report(), { page: "blog", profile: "mobile" });

  it("keep the scores, the metric values, and the failed scored audits", () => {
    assert.deepEqual(kept.categories.performance, { score: 0.92 });
    assert.equal(kept.metrics["speed-index"], 2.5);
    assert.deepEqual(kept.failedAudits.performance, ["performance-audit"]);
    assert.deepEqual(kept.failedAudits["best-practices"], []);
    assert.equal(kept.profile, "mobile");
  });

  it("summarize each page and profile in one row", () => {
    const table = summaryTable([
      kept,
      keptScores(report(), { page: "blog", profile: "mobile" }),
      keptScores(report(), { page: "blog", profile: "desktop" })
    ]).split("\n");
    assert.equal(table.length, 4);
    assert.match(table[2] ?? "", /^\| blog \| desktop \| 1 \| 0\.92 \/ 0\.92 /);
    assert.match(table[3] ?? "", /^\| blog \| mobile \| 2 \|/);
  });
});

type Policy = Record<
  string,
  {
    defaults: Record<string, number>;
    pages: Record<string, Record<string, number | string>>;
  }
>;

describe("the Lighthouse floors", () => {
  const config = createRequire(import.meta.url)("../../lighthouserc.cjs") as {
    pages: Record<string, string | undefined>;
    policy: Policy;
  };
  const workflow = readFileSync(".github/workflows/lighthouse.yml", "utf8");

  it("give each page override a reason, and only known keys", () => {
    for (const [profile, { defaults, pages }] of Object.entries(
      config.policy
    )) {
      for (const [page, override] of Object.entries(pages)) {
        assert.ok(page in config.pages, `${profile}: no page named ${page}`);
        const { reason, ...floors } = override;
        assert.ok(
          typeof reason === "string" && reason.length > 0,
          `${profile} ${page}: the override needs a reason`
        );
        for (const key of Object.keys(floors)) {
          assert.ok(key in defaults, `${profile} ${page}: unknown key ${key}`);
        }
      }
    }
  });

  it("give both profiles the same keys", () => {
    assert.deepEqual(
      Object.keys(config.policy.mobile?.defaults ?? {}),
      Object.keys(config.policy.desktop?.defaults ?? {})
    );
  });

  it("match the workflow's matrix of pages and profiles", () => {
    const list = (name: string) =>
      workflow
        .match(new RegExp(`^\\s+${name}: \\[(.*)\\]$`, "m"))?.[1]
        ?.split(",")
        .map((item) => item.trim());
    assert.deepEqual(list("page"), Object.keys(config.pages));
    assert.deepEqual(list("profile"), Object.keys(config.policy));
  });
});
