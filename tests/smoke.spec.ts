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
    // The Spark tab is left out when the Maven lookup fails, so take the
    // tabs the page rendered.
    const tabs = page
      .getByRole("tablist", { name: "Install Vortex" })
      .getByRole("tab");
    const count = await tabs.count();
    expect(count).toBeGreaterThan(1);
    const heights = new Set<number>();
    for (let i = 0; i < count; i++) {
      await tabs.nth(i).click();
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

  test("the ASCII mark draws the canvas, or the symbol where it can't", async ({
    page
  }) => {
    await page.goto("/");
    const host = page.locator("[data-mark-mode]");
    await expect(host).toHaveCount(1, { timeout: 15000 });
    const mode = await host.getAttribute("data-mark-mode");
    test
      .info()
      .annotations.push({ type: "mark-mode", description: String(mode) });
    if (mode === "live" || mode === "reduced") {
      await expect(host.locator("canvas")).toBeAttached();
    } else {
      await expect(host.locator('img[src*="vortex_symbol"]')).toBeAttached();
    }
    const error = await host.getAttribute("data-mark-error");
    expect(mode, `mounting the mark threw: ${error}`).not.toBe("error");
  });
});

test.describe("home bands", () => {
  test("the benchmark card shows six panels with a source link, or is absent", async ({
    page
  }) => {
    await page.goto("/");
    // The figures are read from bench.vortex.dev at build time. When that
    // read fails the page leaves the whole card out, never part of it.
    const card = page.getByRole("region", { name: "Benchmark summary" });
    if ((await card.count()) === 0) {
      await expect(page.locator(".vx-bench-panel")).toHaveCount(0);
      return;
    }
    await expect(card).toBeVisible();
    await expect(card.locator(".vx-bench-panel")).toHaveCount(6);
    await expect(card.locator(".vx-bench-big")).toHaveCount(6);
    const source = card.locator('a[href="https://bench.vortex.dev"]');
    await expect(source).toBeVisible();
    await expect(source).toContainText(
      /bench\.vortex\.dev · read \d+ \w{3} \d{4}/i
    );
    await expect(card.locator(".vx-bar.is-ours")).toHaveCount(6);
  });

  test("the logo banner shows the twelve cleared logos", async ({ page }) => {
    await page.goto("/");
    const banner = page.getByRole("region", { name: "Who builds on Vortex" });
    await expect(banner).toBeVisible();
    // Only the first set is named; the loop's copies are hidden.
    const names = await banner
      .getByRole("img")
      .evaluateAll((imgs) => imgs.map((i) => i.getAttribute("alt")));
    expect(names).toEqual([
      "Microsoft",
      "Palantir",
      "Firebolt",
      "LangChain",
      "Polar Signals",
      "Milvus",
      "DuckDB",
      "Apache DataFusion",
      "Apache Spark",
      "ClickHouse",
      "Apache Hudi",
      "Apache Paimon"
    ]);
    // Every mark loads.
    for (const img of await banner.getByRole("img").all())
      await expect
        .poll(() =>
          img.evaluate((i: HTMLImageElement) =>
            i.complete ? i.naturalWidth : 0
          )
        )
        .toBeGreaterThan(0);
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

  test("lists the posts as BlogIndex rows, with the feeds and the newsletter", async ({
    page
  }) => {
    test.skip(!seedPostSlug, "no published posts");
    await page.goto("/blog");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Blog");
    const feeds = page.getByRole("navigation", { name: "Feeds" });
    for (const href of ["/rss/feed.xml", "/rss/feed.atom", "/rss/feed.json"])
      await expect(feeds.locator(`a[href="${href}"]`)).toBeVisible();
    const row = page.locator(".vx-posts a.vx-post-row").first();
    await expect(row.locator(".vx-post-row-title")).toBeVisible();
    await expect(row.locator(".vx-post-row-meta time")).toHaveText(
      /^\d{1,2} \w{3} \d{4}$/
    );
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.getByRole("button", { name: "Subscribe" })).toBeVisible();
  });
});

test.describe("blog post", () => {
  test("post heading renders", async ({ page }) => {
    test.skip(!seedPostSlug, "no published posts");
    await page.goto(`/blog/${seedPostSlug}`);
    await expect(page.locator("h1").first()).toBeVisible();
  });

  test("shows one h1, the byline and the More posts list", async ({ page }) => {
    test.skip(!seedPostSlug, "no published posts");
    await page.goto(`/blog/${seedPostSlug}`);
    const article = page.locator("article.vx-article");
    // The post's own top headings move to h2, so the title is the one h1.
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(article.locator("h1")).toBeVisible();
    await expect(article.locator(".vx-article-byline")).toHaveText(
      /^\d{1,2} \w{3} \d{4} · .+ · \d+ min read$/
    );
    const more = article.locator(".vx-article-more");
    await expect(
      more.getByRole("heading", { name: "More posts" })
    ).toBeVisible();
    const rows = more.locator("a.vx-post-row");
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(3);
    await expect(more.locator(`a[href="/blog/${seedPostSlug}"]`)).toHaveCount(
      0
    );
    await expect(
      page.getByRole("link", { name: "Back to blog" })
    ).toHaveAttribute("href", "/blog");
  });

  test("code blocks take the CodeBlock card and the syntax tokens", async ({
    page
  }) => {
    test.skip(!seedPostSlug, "no published posts");
    await page.goto(`/blog/${seedPostSlug}`);
    const block = page.locator("figure.vx-code").first();
    await expect(block.locator(".vx-code-head .vx-label")).not.toBeEmpty();
    await expect(
      block.getByRole("button", { name: "Copy code" })
    ).toBeVisible();
    await expect(block.locator("pre.vx-code-pre")).toBeVisible();
    // Every token takes its colour from a syntax-* token, so code follows
    // the theme.
    const colours = await page
      .locator("figure.vx-code [data-line] span[style]")
      .evaluateAll((spans) => spans.map((s) => s.getAttribute("style")));
    expect(colours.length).toBeGreaterThan(0);
    for (const c of colours) expect(c).toMatch(/var\(--syntax-[a-z]+\)/);
  });

  test("a code block's copy button writes its code", async ({
    page,
    context,
    browserName
  }) => {
    test.skip(!seedPostSlug, "no published posts");
    test.skip(
      browserName !== "chromium",
      "clipboard permissions are Chromium's"
    );
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(`/blog/${seedPostSlug}`);
    const block = page.locator("figure.vx-code").first();
    await block.getByRole("button", { name: "Copy code" }).click();
    await expect(block.getByRole("status")).toHaveText("Copied");
    const code = await block.locator("pre").evaluate((pre) => pre.textContent);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      code
    );
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

test.describe("theme switch", () => {
  test("sets data-theme on the blog, and the choice survives a reload", async ({
    page
  }) => {
    await page.goto("/blog");
    const html = page.locator("html");
    const choice = (name: string) =>
      page.getByRole("group", { name: "Theme" }).getByRole("button", { name });
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(choice("Dark")).toHaveAttribute("aria-pressed", "true");
    await choice("Light").click();
    await expect(html).toHaveAttribute("data-theme", "light");
    await expect(choice("Light")).toHaveAttribute("aria-pressed", "true");
    await expect(choice("Dark")).toHaveAttribute("aria-pressed", "false");
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "light");
    await expect(choice("Light")).toHaveAttribute("aria-pressed", "true");
  });

  test("System follows the OS while the page stays open", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/blog");
    const html = page.locator("html");
    await page
      .getByRole("group", { name: "Theme" })
      .getByRole("button", { name: "System" })
      .click();
    await expect(html).toHaveAttribute("data-theme", "light");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(html).toHaveAttribute("data-theme", "dark");
  });

  test("the homepage has no switch and stays Dark with Light stored", async ({
    page
  }) => {
    await page.addInitScript(() => localStorage.setItem("vx-theme", "light"));
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("group", { name: "Theme" })).toHaveCount(0);
  });

  test("a client navigation from a Light blog to the homepage turns Dark", async ({
    page
  }) => {
    await page.addInitScript(() => localStorage.setItem("vx-theme", "light"));
    await page.goto("/blog");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByRole("link", { name: "Vortex home" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("group", { name: "Theme" })).toHaveCount(0);
  });
});

test.describe("404", () => {
  test("an unknown path returns 404 with the headline, the links and the mark", async ({
    page
  }) => {
    const res = await page.goto("/no-such-page");
    expect(res?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { level: 1, name: "Page not found." })
    ).toBeVisible();
    const main = page.locator("main");
    for (const [name, href] of [
      ["Go to the homepage", "/"],
      ["Read the docs", "https://docs.vortex.dev"],
      ["Read the blog", "/blog"]
    ] as const)
      await expect(main.getByRole("link", { name })).toHaveAttribute(
        "href",
        href
      );
    // The AsciiMark mounts once the page is idle, as on the homepage.
    const host = main.locator("[data-mark-mode]");
    await expect(host).toHaveCount(1, { timeout: 15000 });
    expect(await host.getAttribute("data-mark-mode")).not.toBe("error");
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

  test("404 has no horizontal scroll", async ({ page }) => {
    await page.goto("/no-such-page");
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

// On a phone the BenchmarkCard sets its panels two to a row, each bar under
// its name and value. Beside them, a bar was 15 to 50px wide at 375px.
test.describe("benchmark card on phones", () => {
  for (const width of [320, 375]) {
    test.describe(`at ${width}px`, () => {
      test.use({ viewport: { width, height: 812 } });

      test("bars are readable, rows are ruled, and figures line up", async ({
        page
      }) => {
        await page.goto("/");
        const card = page.getByRole("region", { name: "Benchmark summary" });
        test.skip((await card.count()) === 0, "bench was not read at build");
        const m = await card.evaluate((el) => {
          const top = (e: Element | null) =>
            Math.round(e?.getBoundingClientRect().top ?? 0);
          const panels = [...el.querySelectorAll(".vx-bench-panel")];
          const rows = new Map<number, Element[]>();
          for (const p of panels)
            rows.set(top(p), [...(rows.get(top(p)) ?? []), p]);
          const tracks = [...el.querySelectorAll(".vx-bar-track")];
          return {
            columns: Math.max(...[...rows.values()].map((r) => r.length)),
            narrowest: Math.min(
              ...tracks.map((t) => t.getBoundingClientRect().width)
            ),
            misaligned: [...rows.values()].filter(
              (r) =>
                new Set(r.map((p) => top(p.querySelector(".vx-bench-big"))))
                  .size > 1
            ).length,
            ruled: panels
              .filter((p) => top(p) !== top(panels[0] ?? null))
              .every((p) => getComputedStyle(p).borderTopWidth === "1px")
          };
        });
        expect(m.columns).toBe(2);
        expect(m.narrowest).toBeGreaterThanOrEqual(100);
        expect(m.misaligned).toBe(0);
        expect(m.ruled).toBe(true);
      });
    });
  }
});

test.describe("narrowest phones", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  for (const path of ["/", "/blog"]) {
    test(`${path} has no horizontal scroll at 320px`, async ({ page }) => {
      await page.goto(path);
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    });
  }

  test("the GitHub button shares the wordmark's row at 320px", async ({
    page
  }) => {
    await page.goto("/");
    // Same row: the two groups' vertical centres line up (the header
    // centres a 24px wordmark against a 32px button).
    const middle = (selector: string) =>
      page
        .locator(selector)
        .first()
        .evaluate((e) => {
          const r = e.getBoundingClientRect();
          return r.top + r.height / 2;
        });
    const gap = Math.abs(
      (await middle(".vx-header-end")) - (await middle(".vx-header-start"))
    );
    expect(gap).toBeLessThan(2);
  });
});

test.describe("theme on client navigation", () => {
  test("the destination's theme is set before its page paints", async ({
    page
  }) => {
    await page.goto("/blog");
    await page.evaluate(() => localStorage.setItem("vx-theme", "light"));
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    // A MutationObserver runs after React commits the new route but before
    // the browser paints it, so it sees the theme the first frame uses.
    await page.evaluate(() => {
      const w = window as unknown as { themeAtCommit?: string };
      new MutationObserver((_, observer) => {
        if (document.querySelector("h1.vx-display")) {
          w.themeAtCommit = document.documentElement.dataset.theme ?? "";
          observer.disconnect();
        }
      }).observe(document.body, { childList: true, subtree: true });
    });
    await page.locator('header a[href="/"]').first().click();
    await expect(page.locator("h1.vx-display")).toBeVisible();
    const theme = await page.evaluate(
      () => (window as unknown as { themeAtCommit?: string }).themeAtCommit
    );
    expect(theme).toBe("dark");
  });
});

test.describe("logo banner under reduced motion", () => {
  for (const width of [1440, 375]) {
    test(`shows all twelve logos still at ${width}px`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const logos = page.locator(
        'section[aria-label="Who builds on Vortex"] img:not([alt=""])'
      );
      await expect(logos).toHaveCount(12);
      for (const box of await logos.evaluateAll((imgs) =>
        imgs.map((i) => i.getBoundingClientRect().toJSON())
      )) {
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(width);
      }
    });
  }
});
