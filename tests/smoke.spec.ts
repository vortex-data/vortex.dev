import { expect, test } from "@playwright/test";

/**
 * Browser smoke tests. Structural and behavioral checks against a real
 * browser engine — catches regressions the HTTP-only verify script can't
 * see (hydration, client-mounted WebGL canvas, mobile layout overflow,
 * client-side syntax-highlighting).
 *
 * Not pixel-diff. The 3D hero won't produce a stable WebGL output across
 * Linux/macOS GPU stacks, so screenshots are out of scope. Promote to
 * snapshot diffs only if a regression slips through.
 *
 * The post-dependent specs discover a published slug at runtime by parsing
 * `/blog`'s anchor list. Skips when no published posts are found, so the
 * suite stays useful on a hypothetical empty-content branch.
 */

let seedPostSlug: string | null = null;

test.beforeAll(async () => {
  const baseURL = process.env.BASE_URL ?? "http://localhost:3000";
  try {
    const res = await fetch(`${baseURL}/blog`);
    if (!res.ok) return;
    const html = await res.text();
    const match = html.match(/href="\/blog\/([a-z0-9-]+)"/);
    seedPostSlug = match?.[1] ?? null;
  } catch {
    // leave seedPostSlug as null
  }
});

test.describe("home", () => {
  test("hero copy is visible", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByText(/highly performant.*columnar data format/i)
    ).toBeVisible();
    await expect(page.getByText(/100x faster random access/i)).toBeVisible();
  });

  test("title is correct", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Vortex/);
  });

  test("WebGL hero canvas mounts after hydration", async ({ page }) => {
    await page.goto("/");
    // OGL's Renderer constructor throws when WebGL context creation fails,
    // so the canvas only gets appended if WebGL is actually available.
    // Headless WebKit doesn't always have WebGL — skip there and rely on
    // the hero-copy / title tests above to catch a generic page-load
    // regression. Chromium has SwiftShader fallback so this runs there.
    const hasWebGL = await page.evaluate(() => {
      try {
        return !!document.createElement("canvas").getContext("webgl");
      } catch {
        return false;
      }
    });
    test.skip(!hasWebGL, "browser doesn't support WebGL");
    await expect(page.locator("canvas").first()).toBeAttached({
      timeout: 5000
    });
  });
});

test.describe("blog index", () => {
  test("links to a published post", async ({ page }) => {
    test.skip(!seedPostSlug, "no published posts");
    await page.goto("/blog");
    await expect(
      page.locator(`a[href="/blog/${seedPostSlug}"]`).first()
    ).toBeVisible();
  });
});

test.describe("blog post", () => {
  test("post heading renders", async ({ page }) => {
    test.skip(!seedPostSlug, "no published posts");
    await page.goto(`/blog/${seedPostSlug}`);
    await expect(page.locator("h1").first()).toBeVisible();
  });

  test("rehype-pretty-code syntax highlighting is rendered", async ({
    page
  }) => {
    test.skip(!seedPostSlug, "no published posts");
    await page.goto(`/blog/${seedPostSlug}`);
    // `figure[data-rehype-pretty-code-figure]` + `[data-line]` children are
    // emitted only when the rehype plugin successfully tokenized the code
    // block. A fallback `<pre>` path (e.g. plugin disabled or theme load
    // failure) wouldn't have either attribute.
    const figure = page
      .locator("figure[data-rehype-pretty-code-figure]")
      .first();
    await expect(figure).toBeVisible();
    expect(await figure.locator("[data-line]").count()).toBeGreaterThan(0);
  });
});

test.describe("footer", () => {
  test("custom Link scramble settles back to original on hover", async ({
    page
  }) => {
    await page.goto("/");
    const link = page.locator('a[href="https://lfprojects.org"]').first();
    await expect(link).toBeVisible();
    const original = (await link.textContent()) ?? "";

    // Trigger a real pointer enter — the scramble fires on hover.
    await link.hover();

    // Sample intermediate frames: the in-flight animation must produce at
    // least one text snapshot that differs from the static text. Without
    // the in-flight guard in the Link component, the scramble would loop
    // forever because mutating textContent re-fires mouseover.
    const observed = new Set<string>();
    for (let i = 0; i < 30; i++) {
      observed.add((await link.textContent()) ?? "");
      await page.waitForTimeout(20);
    }

    // Wait for the animation to settle, then assert it returned to the
    // original string (regression check for the textContent-refire loop).
    await page.waitForTimeout(800);
    expect(await link.textContent()).toBe(original);
    expect([...observed].some((s) => s !== original)).toBe(true);
  });
});

test.describe("mobile layout", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("home has no horizontal scroll", async ({ page }) => {
    await page.goto("/");
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  test("blog post page has no horizontal scroll", async ({ page }) => {
    test.skip(!seedPostSlug, "no published posts");
    await page.goto(`/blog/${seedPostSlug}`);
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });
});
