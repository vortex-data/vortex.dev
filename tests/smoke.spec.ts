import { expect, test } from "@playwright/test";

/**
 * Browser smoke tests. Structural and behavioral checks against a real
 * browser engine — catches regressions the HTTP-only verify script can't
 * see (hydration, client-mounted WebGL canvas, mobile layout overflow,
 * client-side syntax-highlighting).
 *
 * Not pixel-diff. The ASCII mark won't produce a stable WebGL output across
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
  test("headline is visible", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "The fastest columnar file format."
      })
    ).toBeVisible();
  });

  test("title is correct", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/The fastest columnar file format/);
  });

  test("install tabs open on Rust and switch on click", async ({ page }) => {
    await page.goto("/");
    const panel = page.getByRole("tabpanel");
    await expect(panel).toContainText("cargo add vortex");
    await page.getByRole("tab", { name: "Python" }).click();
    await expect(page.getByRole("tab", { name: "Python" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("pip install vortex-data");
    await expect(
      page.getByRole("button", { name: "Copy to clipboard" })
    ).toBeVisible();
  });

  test("install tabs are one tab stop: arrows, Home and End", async ({
    page
  }) => {
    await page.goto("/");
    const tab = (name: string) => page.getByRole("tab", { name });
    await tab("Rust").focus();
    await page.keyboard.press("ArrowRight");
    await expect(tab("Python")).toBeFocused();
    await expect(tab("Python")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("End");
    await expect(tab("CLI")).toBeFocused();
    await expect(page.getByRole("tabpanel")).toContainText(
      "uvx --from vortex-data vx --help"
    );
    await page.keyboard.press("Home");
    await expect(tab("Rust")).toBeFocused();
    await expect(tab("Rust")).toHaveAttribute("tabindex", "0");
    await expect(tab("CLI")).toHaveAttribute("tabindex", "-1");
  });

  test("switching install tabs never changes the block's height", async ({
    page
  }) => {
    await page.goto("/");
    const block = page.locator(".vx-tabs");
    const heights = new Set<number>();
    for (const name of ["Rust", "Python", "DuckDB", "Spark", "CLI"]) {
      await page.getByRole("tab", { name }).click();
      heights.add((await block.boundingBox())?.height ?? 0);
    }
    expect([...heights]).toHaveLength(1);
  });

  test("copy writes the selected commands without the prompt", async ({
    page,
    context,
    browserName
  }) => {
    test.skip(
      browserName !== "chromium",
      "clipboard permissions are Chromium's"
    );
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");
    await page.getByRole("tab", { name: "Python" }).click();
    await page.getByRole("button", { name: "Copy to clipboard" }).click();
    await expect(page.getByRole("status")).toHaveText("Copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      "pip install vortex-data"
    );
  });

  test("the ASCII mark mounts, or shows the symbol without WebGL", async ({
    page
  }) => {
    await page.goto("/");
    // three.js needs WebGL 2. Headless WebKit doesn't always have it, and
    // then the mark falls back to the static symbol. Chromium has the
    // SwiftShader fallback, so the canvas case runs there.
    const hasWebGL2 = await page.evaluate(() => {
      try {
        return !!document.createElement("canvas").getContext("webgl2");
      } catch {
        return false;
      }
    });
    const hero = page.locator("main section").first();
    if (hasWebGL2) {
      await expect(hero.locator("canvas")).toBeAttached({ timeout: 10000 });
    } else {
      await expect(hero.locator('img[src*="vortex_symbol"]')).toBeAttached({
        timeout: 10000
      });
    }
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

test.describe("header", () => {
  test("shows the five nav links and the GitHub button", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Primary" });
    for (const [name, href] of [
      ["Docs", "https://docs.vortex.dev"],
      ["Bench", "https://bench.vortex.dev"],
      ["Explorer", "https://explore.vortex.dev"],
      ["Blog", "/blog"],
      ["Slack", "/slack"]
    ] as const) {
      const link = nav.getByRole("link", { name, exact: true });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute("href", href);
    }
    // The star count is left out when GitHub's API fails, so only the
    // repository name is certain.
    const github = page.locator(
      'header a[href="https://github.com/vortex-data/vortex"]'
    );
    await expect(github).toBeVisible();
    await expect(github).toContainText("vortex-data/vortex");
  });
});

test.describe("footer", () => {
  test("shows the LF Projects policies link and the Charter", async ({
    page
  }) => {
    await page.goto("/");
    const footer = page.locator("footer");
    await expect(
      footer.locator('a[href="https://lfprojects.org/policies"]')
    ).toBeVisible();
    const charter = footer.getByRole("link", { name: "Charter", exact: true });
    await expect(charter).toBeVisible();
    await expect(charter).toHaveAttribute("href", "/charter.pdf");
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
