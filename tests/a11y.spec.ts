import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

/**
 * Accessibility checks with axe, for both apps.
 *
 * The site's pages run against `BASE_URL`, like the smoke specs. bench's pages
 * run only when `BENCH_URL` names where bench starts: `http://host/bench` on a
 * preview or a local build, or `https://bench.vortex.dev`. bench needs its
 * database to render, so CI runs both on the pull request's Vercel preview
 * with `--grep @axe` (see `.github/workflows/lighthouse.yml`), and the smoke
 * run in ci.yml leaves them out with `--grep-invert @axe`. The tag sits in
 * each title, not in an options object, which Biome's Playwright rule
 * rejects.
 *
 * A page fails on any violation that axe rates serious or critical, against
 * WCAG 2.1 A and AA, except the known ones below. Moderate and minor ones are
 * printed, not failed.
 */

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const FAILING_IMPACTS = new Set(["serious", "critical"]);

/**
 * A violation that is known and not fixed yet. It is skipped only on the
 * nodes its target matches, so the same rule still fails anywhere else.
 */
type Known = { id: string; target: RegExp };

async function expectNoSeriousViolations(
  page: Page,
  label: string,
  known: Known[] = []
) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
    .analyze();
  const failing = violations
    .filter((v) => FAILING_IMPACTS.has(v.impact ?? ""))
    .map((v) => ({
      ...v,
      nodes: v.nodes.filter(
        (n) =>
          !known.some((k) => k.id === v.id && k.target.test(n.target.join(" ")))
      )
    }))
    .filter((v) => v.nodes.length > 0);
  for (const v of violations.filter(
    (v) => !FAILING_IMPACTS.has(v.impact ?? "")
  )) {
    console.log(
      `${label}: ${v.impact} ${v.id} (${v.nodes.length} nodes): ${v.help}`
    );
  }
  const report = failing.map(
    (v) =>
      `${v.impact} ${v.id}: ${v.help}\n` +
      v.nodes
        .slice(0, 5)
        .map((n) => `    ${n.target.join(" ")}`)
        .join("\n")
  );
  expect(report, `${label}: serious or critical axe violations`).toEqual([]);
}

test.describe("site @axe", () => {
  let postSlug: string | null = null;

  test.beforeAll(async () => {
    const baseURL = process.env.BASE_URL ?? "http://localhost:3000";
    const html = await (await fetch(`${baseURL}/blog`)).text();
    postSlug = html.match(/href="\/blog\/([a-z0-9-]+)"/)?.[1] ?? null;
  });

  for (const path of ["/", "/blog", "/no-such-page"]) {
    test(`${path} has no serious axe violations`, async ({ page }) => {
      await page.goto(path);
      await expectNoSeriousViolations(page, path);
    });
  }

  test("a blog post has no serious axe violations", async ({ page }) => {
    test.skip(!postSlug, "no published post on /blog");
    await page.goto(`/blog/${postSlug}`);
    await expectNoSeriousViolations(page, `/blog/${postSlug}`);
  });

  test("the blog in the dark theme has no serious axe violations", async ({
    page
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/blog");
    await expectNoSeriousViolations(page, "/blog (dark)");
  });
});

/**
 * bench's group row is a `<summary>` that holds the info tooltip, the docs
 * link and the permalink, so controls sit inside a control. The fix moves
 * them out of the row, which changes its layout, so it waits for its own PR.
 */
const BENCH_KNOWN: Known[] = [
  // axe names a summary by its tag, or by its class under the group's id
  // (`#compression > .group-disclosure > .group-summary`).
  {
    id: "nested-interactive",
    target: /(^|[ >])(summary(\.group-summary)?|\.group-summary)$/
  }
];

test.describe("bench @axe", () => {
  const benchUrl = process.env.BENCH_URL?.replace(/\/$/, "");
  test.skip(!benchUrl, "BENCH_URL is not set");
  const at = (path: string) => `${benchUrl}${path === "/" ? "/" : path}`;

  let chartSlug: string | null = null;

  test.beforeAll(async ({ request }) => {
    if (!benchUrl) return;
    const response = await request.get(at("/api/groups"));
    expect(response.status(), "GET /api/groups").toBe(200);
    const body = (await response.json()) as {
      groups: { charts: { slug: string }[] }[];
    };
    chartSlug =
      body.groups.find((g) => g.charts.length > 0)?.charts[0]?.slug ?? null;
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`the landing page in ${scheme} has no serious axe violations`, async ({
      page
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(at("/"));
      await expect(page.locator(".group-disclosure").first()).toBeVisible();
      await expectNoSeriousViolations(page, `bench / (${scheme})`, BENCH_KNOWN);
    });
  }

  test("an open group has no serious axe violations", async ({ page }) => {
    await page.goto(at("/"));
    const summary = page.locator(".group-summary").first();
    await summary.click();
    const section = page.locator("section", { has: summary });
    await expect(section.locator(".chart-card").first()).toBeVisible();
    await expect(section.locator(".chart-card .chart-loading")).toHaveCount(0, {
      timeout: 15_000
    });
    await expectNoSeriousViolations(
      page,
      "bench / (first group open)",
      BENCH_KNOWN
    );
  });

  test("a chart page has no serious axe violations", async ({ page }) => {
    test.skip(!chartSlug, "no group has a chart");
    await page.goto(at(`/chart/${chartSlug}`));
    await expect(page.locator(".chart-card")).toBeVisible();
    await expect(page.locator(".chart-card .chart-loading")).toHaveCount(0, {
      timeout: 15_000
    });
    await expectNoSeriousViolations(
      page,
      `bench /chart/${chartSlug}`,
      BENCH_KNOWN
    );
  });
});
