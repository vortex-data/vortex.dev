// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

/** How many chart pages to capture: the first chart of the first this many groups. */
const CHART_PAGES = 5;
const CHART_SETTLE_TIMEOUT_MS = 60_000;

test.beforeEach(async ({ page }) => {
  // The heading font loads from Google Fonts after first paint. Block it, so that a slow or absent
  // network cannot give one run the web font and the other the fallback.
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
});

let chartSlugs: Promise<string[]> | undefined;

/** The first chart of each of the first groups, read from the server under test. */
function firstChartSlugs(request: APIRequestContext): Promise<string[]> {
  chartSlugs ??= (async () => {
    const response = await request.get('/api/groups');
    expect(response.status(), 'GET /api/groups').toBe(200);
    const body = (await response.json()) as { groups: { charts: { slug: string }[] }[] };
    const slugs = body.groups.slice(0, CHART_PAGES).map((group) => group.charts[0]?.slug);
    expect(slugs.filter(Boolean), `the first ${CHART_PAGES} groups each need a chart`).toHaveLength(
      CHART_PAGES,
    );
    return slugs as string[];
  })();
  return chartSlugs;
}

/** Wait for a page's server-rendered content, its fonts and its scripts. */
async function settlePage(page: Page): Promise<void> {
  await expect(page.locator('main')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
}

/**
 * Wait until a chart card has finished: drawn, or hidden because its chart is empty. A card that
 * failed to load fails the test, because a screenshot of an error would agree with another one.
 */
async function settleCard(card: Locator): Promise<void> {
  await expect(async () => {
    const state = await card.evaluate((element) => ({
      hidden: element.hasAttribute('hidden'),
      busy: element.querySelector('.chart-placeholder, .chart-loading') !== null,
    }));
    expect(state.hidden || !state.busy, 'the chart is still loading').toBe(true);
  }).toPass({ timeout: CHART_SETTLE_TIMEOUT_MS });
  await expect(card.locator('.chart-error')).toHaveCount(0);
}

test('landing page', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('section.group-details').first()).toBeVisible();
  await settlePage(page);
  await expect(page).toHaveScreenshot('landing.png', { fullPage: true });
});

test('landing page with the first group open', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('section.group-details').first()).toBeVisible();
  await settlePage(page);

  const section = page.locator('section.group-details').first();
  await section.locator('summary.group-summary').click();
  // Charts draw when they scroll near the viewport, so visit every one before the screenshot.
  const cards = section.locator('.chart-card');
  for (let index = 0, count = await cards.count(); index < count; index++) {
    const card = cards.nth(index);
    await card.evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await settleCard(card);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  // Keep the pointer off every chart, so no tooltip or hover style depends on where the page
  // scrolled.
  await page.mouse.move(0, 0);
  await expect(section).toHaveScreenshot('landing-first-group-open.png');
});

for (let pageNumber = 1; pageNumber <= CHART_PAGES; pageNumber++) {
  test(`chart page ${pageNumber}`, async ({ page, request }) => {
    const slug = (await firstChartSlugs(request))[pageNumber - 1];
    test.info().annotations.push({ type: 'slug', description: slug });
    await page.goto(`/chart/${slug}`);
    await settlePage(page);
    await settleCard(page.locator('.chart-card'));
    await page.mouse.move(0, 0);
    await expect(page).toHaveScreenshot(`chart-${pageNumber}.png`, { fullPage: true });
  });
}
