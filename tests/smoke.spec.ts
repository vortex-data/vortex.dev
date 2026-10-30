import { expect, type Page, test } from "@playwright/test";
import { externalPosts } from "../src/content/links";

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
        name: "Fast, small, open: pick three."
      })
    ).toBeVisible();
  });

  // Note 81: the hero says what Vortex is, above the fold, in one line.
  test("the standfirst says what Vortex is", async ({ page }) => {
    await page.setViewportSize({ width: 1512, height: 860 });
    await page.goto("/");
    const standfirst = page.getByText(
      "Vortex is an open-source columnar file format for fast scans, random access, and compression."
    );
    await expect(standfirst).toBeVisible();
    const box = await standfirst.boundingBox();
    expect(box?.height ?? 99).toBeLessThan(36);
    expect((box?.y ?? 999) + (box?.height ?? 0)).toBeLessThan(430);
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
    await expect(panel).toContainText("uv add vortex-data");
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
      "uv add vortex-data"
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

  // Note 62: each bar ends in its score, with the unit for screen readers
  // and as its hover title. Note 63: the value carries a short unit, ms for
  // a time and × for a ratio. Lance cannot run in cuDF, so it is N/A there,
  // and the hand-kept GPU panel's source is named under the panels.
  test("each bar ends in its value and unit, keeps its full unit for screen readers, and the GPU panel names its source", async ({
    page
  }) => {
    await page.goto("/");
    const card = page.getByRole("region", { name: "Benchmark summary" });
    test.skip((await card.count()) === 0, "bench was not read at build");
    const bars = await card.locator(".vx-bar").evaluateAll((rows) =>
      rows.map((r) => ({
        title: r.getAttribute("title") ?? "",
        value: r.querySelector(".vx-bar-value")?.textContent ?? null,
        sr: r.querySelector(".vx-sr-only")?.textContent ?? null,
        missing: r.querySelector(".vx-bar-missing") !== null
      }))
    );
    expect(bars.length).toBeGreaterThanOrEqual(19);
    for (const b of bars) {
      if (b.missing) {
        expect(b.title).toMatch(/: Not measured$/);
        continue;
      }
      expect(b.value).toMatch(/^(\d[\d.]*(×| ms)|N\/A)$/);
      expect(b.title.endsWith(`: ${b.sr}`)).toBe(true);
    }
    // The value column is one width in every row of a panel, so its bars
    // share a scale.
    const widths = await card
      .locator(".vx-bars")
      .evaluateAll((panels) =>
        panels.map(
          (p) =>
            new Set(
              [...p.querySelectorAll(".vx-bar-track")].map((t) =>
                Math.round(t.getBoundingClientRect().width)
              )
            ).size
        )
      );
    expect(widths).toEqual([1, 1, 1, 1, 1, 1]);
    // Note 81: a short caption, with the method as its title and for
    // screen readers.
    const sub = card.locator(".vx-bench-sub");
    await expect(sub).toHaveText(
      /^· times in ms, ratios to Parquet, best first\. A time is the geomean/
    );
    await expect(sub).toHaveAttribute(
      "title",
      /A ratio is against Parquet = 1\.$/
    );
    await expect(
      card.locator(
        '.vx-bar.is-na[title="Lance: not available, no cuDF integration"]'
      )
    ).toHaveCount(1);
    await expect(card.locator(".vx-bench-foot")).toHaveText(
      /^GPU analytics with cuDF: .*UW–Madison talk$/
    );
  });

  test("the logo banner shows the thirteen cleared logos", async ({ page }) => {
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
      "Spiral",
      "Firebolt",
      "LangChain",
      "Dash0",
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

test.describe("blog index list", () => {
  test("one list, newest first, mixes own posts with posts elsewhere", async ({
    page
  }) => {
    await page.goto("/blog");
    await expect(page.locator("ul.vx-posts")).toHaveCount(1);
    for (const gone of [".vx-post-lead", ".vx-posts-head", ".vx-cover"])
      await expect(page.locator(gone)).toHaveCount(0);
    const rows = page.locator("ul.vx-posts > li > a.vx-post-row");
    await expect(rows).toHaveCount(7 + externalPosts.length);
    const dates = await rows
      .locator(".vx-post-row-meta time")
      .evaluateAll((ts) => ts.map((t) => t.getAttribute("datetime") ?? ""));
    const times = dates.map((d) => Date.parse(d));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    await expect(
      page.locator('a.vx-post-row[href="/blog/btrblocks-compressor"]')
    ).toHaveCount(1);
  });

  test("a post elsewhere is a plain link that names its source and says it leaves", async ({
    page
  }) => {
    await page.goto("/blog");
    const external = page.locator("a.vx-post-row.is-external");
    await expect(external).toHaveCount(externalPosts.length);
    const first = externalPosts[0];
    if (!first) throw new Error("no external posts");
    const row = page.locator(`a.vx-post-row[href="${first.url}"]`);
    await expect(row).not.toHaveAttribute("target", /.*/);
    await expect(row.locator(".vx-post-row-source")).toHaveText(
      `Elsewhere, on ${first.source}`
    );
    await expect(row.locator(".vx-post-row-source")).toHaveAttribute(
      "title",
      first.source
    );
    await expect(
      row.locator(".vx-post-row-source svg.vx-post-row-out")
    ).toHaveAttribute("aria-hidden", "true");
    await expect(
      // A plain string matches a substring of the name, so the host's dots
      // stay literal (no RegExp built from data).
      page.getByRole("link", { name: `Elsewhere, on ${first.source}` })
    ).not.toHaveCount(0);
    // Own posts carry no source.
    await expect(
      page.locator("a.vx-post-row:not(.is-external) .vx-post-row-source")
    ).toHaveCount(0);
  });

  // Note 81: a long host (datalakehousehub.com) ran out of the meta column
  // into the title. Every listed host stays inside its row's meta.
  for (const [width, height] of [
    [1512, 860],
    [1440, 900],
    [375, 812]
  ] as const) {
    test(`every source host stays in its meta at ${width}px`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/blog");
      const out = await page
        .locator("a.vx-post-row.is-external")
        .evaluateAll((rows) =>
          rows.flatMap((row) => {
            const meta = row.querySelector(".vx-post-row-meta");
            const host = row.querySelector(".vx-post-row-host");
            const source = row.querySelector(".vx-post-row-source");
            if (!meta || !host || !source) return ["missing parts"];
            const m = meta.getBoundingClientRect();
            const s = source.getBoundingClientRect();
            const clipped = host.scrollWidth > host.clientWidth + 1;
            return s.right > m.right + 0.5 || s.left < m.left - 0.5 || clipped
              ? [host.textContent ?? ""]
              : [];
          })
        );
      expect(out).toEqual([]);
    });
  }
});

test.describe("blog post", () => {
  test("post heading renders", async ({ page }) => {
    test.skip(!seedPostSlug, "no published posts");
    await page.goto(`/blog/${seedPostSlug}`);
    await expect(page.locator("h1").first()).toBeVisible();
  });

  test("shows one h1 and the byline, and ends on older and newer posts", async ({
    page
  }) => {
    test.skip(!seedPostSlug, "no published posts");
    await page.goto(`/blog/${seedPostSlug}`);
    const article = page.locator("article.vx-article");
    // The post's own top headings move to h2, so the title is the one h1.
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(article.locator("h1")).toBeVisible();
    await expect(article.locator(".vx-article-byline")).toHaveText(
      /^\d{1,2} \w{3} \d{4} · .+ · \d+ min read$/
    );
    const nav = article.getByRole("navigation", {
      name: "Older and newer posts"
    });
    expect(await nav.locator("a.vx-post-nav-link").count()).toBeGreaterThan(0);
    await expect(nav.locator(`a[href="/blog/${seedPostSlug}"]`)).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Back to blog" })
    ).toHaveAttribute("href", "/blog");
  });

  test("the head reads the title, the dek and the byline, with no kind and no cover", async ({
    page
  }) => {
    await page.goto("/blog/btrblocks-compressor");
    const article = page.locator("article.vx-article");
    await expect(
      article.locator("> header.vx-article-head:first-child")
    ).toHaveCount(1);
    for (const gone of [".vx-cover", ".vx-article-kind", ".vx-eyebrow"])
      await expect(article.locator(gone)).toHaveCount(0);
    const head = article.locator(".vx-article-head");
    await expect(head.locator(".vx-article-dek")).toHaveText(
      /BtrBlocks-style codec selection/
    );
    await expect(
      article.locator(".vx-post-nav-link .vx-label").first()
    ).toHaveText(/^(Previous|Next)$/);
    await page.goto("/blog/november-2025");
    const dek = page.locator(".vx-article-dek");
    await expect(dek).toContainText("Polar Signals");
    // Two lines at most, except on a phone, where the dek runs to its end.
    const lines = await dek.evaluate(
      (e) =>
        e.getBoundingClientRect().height /
        Number.parseFloat(getComputedStyle(e).lineHeight)
    );
    if ((page.viewportSize()?.width ?? 0) > 640)
      expect(lines).toBeLessThanOrEqual(2.05);
    else
      expect(await dek.evaluate((e) => e.scrollHeight <= e.clientHeight)).toBe(
        true
      );
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

// Note 56: under the blog a 404 follows the reader's theme, and the mark
// draws in Light rather than leaving a hole.
test("a 404 under the blog in Light draws the mark", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("vx-theme", "light"));
  const res = await page.goto("/blog/no-such-post");
  expect(res?.status()).toBe(404);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const host = page.locator("main [data-mark-mode]");
  await expect(host).toHaveCount(1, { timeout: 15000 });
  expect(await host.getAttribute("data-mark-mode")).not.toBe("error");
  await expect(host).toBeVisible();
  const box = await host.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThan(100);
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

  test("credits the donor right after the LF line", async ({ page }) => {
    await page.goto("/");
    const credit = page.locator("footer .vx-footer-credit");
    await expect(credit).toHaveText("Donated by Spiral.");
    await expect(page.locator("footer .vx-footer-text")).toContainText(
      "lfprojects.org/policies. Donated by Spiral."
    );
    expect(await credit.evaluate((e) => getComputedStyle(e).display)).toBe(
      "inline"
    );
    await expect(credit.getByRole("link", { name: "Spiral" })).toHaveAttribute(
      "href",
      "https://spiraldb.com"
    );
  });
});

// Each logo links to its owner's page about Vortex, or its homepage. The
// copies that keep the loop seamless keep their links out of the tab order,
// so a keyboard reaches each owner once.
test.describe("logo banner links", () => {
  test("every logo is a named link, and only the first set is tabbable", async ({
    page
  }) => {
    await page.goto("/");
    const sets = page.locator(".vx-logos-set");
    const first = sets.first().locator("a");
    const names = await first.evaluateAll((links) =>
      links.map((a) => [
        a.querySelector("img")?.getAttribute("alt"),
        a.getAttribute("href"),
        a.getAttribute("tabindex")
      ])
    );
    expect(names.slice(0, 3).map(([n]) => n)).toEqual([
      "Microsoft",
      "Palantir",
      "Spiral"
    ]);
    for (const [name, href, tabindex] of names) {
      expect(name, "each link is named by its logo").toBeTruthy();
      expect(href).toMatch(/^https:\/\//);
      expect(tabindex).toBeNull();
    }
    expect(names.map(([n]) => n)).toContain("Dash0");
    expect(names.map(([n]) => n)).not.toContain("Polar Signals");
    const copies = await sets
      .nth(1)
      .locator("a")
      .evaluateAll((links) => links.map((a) => a.getAttribute("tabindex")));
    expect(copies.length).toBe(names.length);
    expect(new Set(copies)).toEqual(new Set(["-1"]));
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
// its name. Beside them, a bar was 15 to 50px wide at 375px.
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

// Note 60: the card sets 2, 3 or 6 columns by its own width, so between
// phones and 1440px a bar is never squeezed to 26 or 30px.
test.describe("benchmark card columns", () => {
  for (const [width, columns] of [
    [640, 2],
    [1024, 3],
    [1440, 6]
  ] as const) {
    test.describe(`at ${width}px`, () => {
      test.use({ viewport: { width, height: 900 } });

      test(`${columns} columns, with bars of 60px or more`, async ({
        page
      }) => {
        await page.goto("/");
        const card = page.getByRole("region", { name: "Benchmark summary" });
        test.skip((await card.count()) === 0, "bench was not read at build");
        const m = await card.evaluate((el) => {
          const tops = [...el.querySelectorAll(".vx-bench-panel")].map((p) =>
            Math.round(p.getBoundingClientRect().top)
          );
          const first = tops.filter((t) => t === tops[0]).length;
          const tracks = [...el.querySelectorAll(".vx-bar-track")];
          return {
            first,
            narrowest: Math.min(
              ...tracks.map((t) => t.getBoundingClientRect().width)
            )
          };
        });
        expect(m.first).toBe(columns);
        expect(m.narrowest).toBeGreaterThanOrEqual(60);
      });
    });
  }
});

// Note 62: the homepage fits one screen on a 14-inch laptop's browser and at
// 1440 × 900, with the footer in view and nothing to scroll.
test.describe("home fits one screen", () => {
  for (const [width, height] of [
    [1440, 900],
    [1512, 860]
  ] as const) {
    test(`at ${width} × ${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      const m = await page.evaluate(() => {
        const foot = document.querySelector("footer")?.getBoundingClientRect();
        return {
          scroll: document.documentElement.scrollHeight - window.innerHeight,
          footTop: foot?.top ?? Number.POSITIVE_INFINITY,
          footBottom: foot?.bottom ?? Number.POSITIVE_INFINITY
        };
      });
      expect(m.scroll).toBeLessThanOrEqual(0);
      expect(m.footTop).toBeLessThan(height);
      expect(m.footBottom).toBeLessThanOrEqual(height);
    });
  }

  // Note 81: the standfirst fits in the text's free height, so the mark's
  // host keeps the size it had before (472px wide, as tall as the hero).
  for (const [width, height, side] of [
    [1512, 860, 383],
    [1440, 900, 423],
    [1512, 982, 472]
  ] as const) {
    test(`the mark keeps its size at ${width} × ${height}`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      const box = await page.locator('[class*="markHost"]').boundingBox();
      expect(Math.round(box?.width ?? 0)).toBe(472);
      expect(Math.round(box?.height ?? 0)).toBeGreaterThanOrEqual(side);
    });
  }
});

// Note 81, fix 6: without scripts the static symbol stands in for the mark,
// so the hero takes its content's height plus the scripts-on page's
// breathing room, instead of stretching to fill a tall window.
test.describe("home without scripts", () => {
  test.use({ javaScriptEnabled: false });

  for (const height of [860, 1400]) {
    test(`the hero hugs its content at 1512 × ${height}`, async ({ page }) => {
      await page.setViewportSize({ width: 1512, height });
      await page.goto("/");
      const m = await page.evaluate(() => {
        const box = (s: string) =>
          document.querySelector(s)?.getBoundingClientRect() ?? null;
        return {
          header: box("header")?.bottom ?? 0,
          eyebrow: box(".vx-eyebrow")?.top ?? 0,
          tabs: box(".vx-tabs")?.bottom ?? 0,
          bench: box(".vx-bench")?.top ?? 0,
          still: box(".ascii-mark-still")
        };
      });
      expect(m.eyebrow - m.header).toBeGreaterThanOrEqual(64);
      expect(m.eyebrow - m.header).toBeLessThanOrEqual(80);
      expect(m.bench - m.tabs).toBeGreaterThanOrEqual(56);
      expect(m.bench - m.tabs).toBeLessThanOrEqual(72);
      // The symbol is a little larger than the mark's own 40% fallback, and
      // sits beside the stacked install block.
      expect(m.still?.width ?? 0).toBeGreaterThanOrEqual(240);
      const mid = ((m.still?.top ?? 0) + (m.still?.bottom ?? 0)) / 2;
      expect(mid).toBeGreaterThan(m.eyebrow);
      expect(mid).toBeLessThan(m.tabs);
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

// WCAG 2.2.2: the moving banner pauses from its control, by keyboard as well
// as by pointer, and resumes on a second press.
test.describe("logo banner pause", () => {
  const playState = (page: Page) =>
    page
      .locator(".vx-logos-track")
      .evaluate((t) => getComputedStyle(t).animationPlayState);

  test("pauses and resumes from the keyboard", async ({ page }) => {
    await page.goto("/");
    const banner = page.getByRole("region", { name: "Who builds on Vortex" });
    const pause = banner.getByRole("button", { name: "Pause the logos" });
    await expect(pause).toBeVisible();
    await expect(pause).toHaveAttribute("aria-pressed", "false");
    expect(await playState(page)).toBe("running");
    await pause.focus();
    // Focus on the control alone does not pause the loop.
    expect(await playState(page)).toBe("running");
    const box = await pause.boundingBox();
    await page.keyboard.press("Space");
    await expect(pause).toHaveAttribute("aria-pressed", "true");
    expect(await playState(page)).toBe("paused");
    // Pressing changes no size, so nothing around it moves.
    expect(await pause.boundingBox()).toEqual(box);
    await page.keyboard.press("Enter");
    await expect(pause).toHaveAttribute("aria-pressed", "false");
    expect(await playState(page)).toBe("running");
  });

  test("pauses from a pointer or a tap", async ({ page }) => {
    await page.goto("/");
    const pause = page.getByRole("button", { name: "Pause the logos" });
    await pause.click();
    await expect(pause).toHaveAttribute("aria-pressed", "true");
    // Move the pointer off the band, so hover does not hold the loop.
    await page.mouse.move(0, 0);
    expect(await playState(page)).toBe("paused");
  });

  test("is hidden under reduced motion, when nothing moves", async ({
    page
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Pause the logos" })
    ).toBeHidden();
  });
});

test.describe("logo banner under reduced motion", () => {
  for (const width of [1440, 375]) {
    test(`shows all thirteen logos still at ${width}px`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const logos = page.locator(
        'section[aria-label="Who builds on Vortex"] img:not([alt=""])'
      );
      await expect(logos).toHaveCount(13);
      for (const box of await logos.evaluateAll((imgs) =>
        imgs.map((i) => i.getBoundingClientRect().toJSON())
      )) {
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(width);
      }
    });
  }
});

// Rules the site once patched in globals.css, which the design system now
// carries: the header with a ThemeSwitch, Field, prose lists, numeric cells
// and the post rows.
test.describe("design system rules on the blog", () => {
  const POST = "/blog/btrblocks-compressor";
  // A row's text starts with its meta (the date), which sits in its first column.
  const x = async (page: Page, selector: string) =>
    (await page.locator(selector).first().boundingBox())?.x ?? Number.NaN;

  test("each row's title is an h2, and its text is in line with the heading", async ({
    page
  }) => {
    await page.goto("/blog");
    const row = page.locator("ul.vx-posts > li > a.vx-post-row").first();
    await expect(row.locator("h2.vx-post-row-title")).toBeVisible();
    const gap =
      (await x(page, ".vx-post-row-meta")) - (await x(page, ".vx-blog-title"));
    expect(Math.abs(gap)).toBeLessThan(1);
  });

  test("prose lists keep their markers under the site's reset", async ({
    page
  }) => {
    await page.goto(POST);
    const marker = (selector: string) =>
      page
        .locator(selector)
        .first()
        .evaluate((e) => getComputedStyle(e).listStyleType);
    expect(await marker(".vx-prose > ul")).toBe("disc");
    expect(await marker(".vx-prose > ol")).toBe("decimal");
  });

  test("a numeric cell keeps its number on one line", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(POST);
    const cell = page.locator(".vx-prose td.is-num").first();
    expect(await cell.evaluate((e) => getComputedStyle(e).whiteSpace)).toBe(
      "nowrap"
    );
  });

  test("the email field takes the focus ring", async ({ page }) => {
    await page.goto("/blog");
    const field = page.getByLabel("Email address");
    await field.focus();
    const ring = await field.evaluate((e) => {
      const s = getComputedStyle(e);
      return `${s.outlineStyle} ${s.outlineWidth}`;
    });
    expect(ring).toBe("solid 2px");
  });

  test("the GitHub button's name starts with its visible text", async ({
    page
  }) => {
    await page.goto("/blog");
    await expect(
      page.locator('header a[href="https://github.com/vortex-data/vortex"]')
    ).toHaveAccessibleName(/^vortex-data\/vortex( [\d.]+k? stars)? on GitHub$/);
  });

  for (const [width, rows] of [
    [1000, 1],
    [900, 2]
  ] as const) {
    test(`the blog header takes ${rows} row${rows > 1 ? "s" : ""} at ${width}px, and nothing overflows`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/blog");
      const box = async (selector: string) => {
        const b = await page.locator(selector).first().boundingBox();
        if (!b) throw new Error(`${selector} has no box`);
        return b;
      };
      const nav = await box(".vx-header-nav");
      const end = await box(".vx-header-end");
      expect(nav.y >= end.y + end.height).toBe(rows === 2);
      const header = page.locator(".vx-header");
      const fits = await header.evaluate((e) => e.scrollWidth <= e.clientWidth);
      expect(fits).toBe(true);
    });
  }
});

// Each post's Cover, drawn from its slug at build time, is its Open Graph
// image only: no page shows it.
test.describe("covers", () => {
  test("each post's Open Graph image is its own 1200 × 630 PNG", async ({
    request
  }) => {
    const sizes = new Set<number>();
    for (const slug of ["btrblocks-compressor", "welcome"]) {
      const res = await request.get(`/blog/${slug}/opengraph-image`);
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toBe("image/png");
      const png = await res.body();
      expect(png.readUInt32BE(16)).toBe(1200);
      expect(png.readUInt32BE(20)).toBe(630);
      sizes.add(png.length);
    }
    expect(sizes.size).toBe(2);
  });
});

// The posts' own numbers and words, drawn with the design system's cards.
test.describe("figures, chains, quotes and references", () => {
  test("btrblocks shows its TPC-H sizes as bars above the table, Vortex in Blue", async ({
    page
  }) => {
    await page.goto("/blog/btrblocks-compressor");
    const figure = page.locator(".vx-prose > figure.vx-figure").first();
    await expect(figure.locator(".vx-figure-frame")).toHaveAttribute(
      "aria-label",
      /Parquet \+ zstd 4,465, Vortex default 2,776, Vortex compact 2,016/
    );
    await expect(figure.locator(".vx-bar.is-ours")).toHaveCount(2);
    const table = page.locator(".vx-prose .vx-table-wrap").last();
    const [f, t] = await Promise.all([
      figure.boundingBox(),
      table.boundingBox()
    ]);
    expect((f?.y ?? 0) < (t?.y ?? 0)).toBe(true);
  });

  test("the cascades are chains of steps", async ({ page }) => {
    await page.goto("/blog/btrblocks-compressor");
    const chains = page.locator(".vx-prose > .vx-chain");
    await expect(chains).toHaveCount(2);
    await expect(chains.first()).toHaveAttribute(
      "aria-label",
      "Dictionary, then REE, then BitPacking"
    );
    const step = chains.first().locator(".vx-chain-step").first();
    expect(await step.evaluate((e) => getComputedStyle(e).borderTopStyle)).toBe(
      "solid"
    );
  });

  test("commit counts are grey bars, and names alone are a grid", async ({
    page
  }) => {
    await page.goto("/blog/october-2025");
    const bars = page.locator(".vx-figure .vx-bar");
    expect(await bars.count()).toBeGreaterThan(5);
    await expect(page.locator(".vx-figure .vx-bar.is-ours")).toHaveCount(0);
    await expect(
      page.locator("figure.vx-code", { hasText: "Connor Tsui" })
    ).toHaveCount(0);
    await page.goto("/blog/december-2025");
    const names = page.locator("ul.vx-names li");
    expect(await names.count()).toBeGreaterThan(10);
    expect(
      await page
        .locator("ul.vx-names")
        .evaluate((e) => getComputedStyle(e).display)
    ).toBe("grid");
  });

  test("the Polar Signals line is a Quote with its source linked", async ({
    page
  }) => {
    await page.goto("/blog/november-2025");
    const quote = page.locator("figure.vx-quote");
    await expect(quote.locator("blockquote")).toContainText("70% average");
    await expect(quote.locator("figcaption a")).toHaveAttribute(
      "href",
      /polarsignals\.com/
    );
  });

  test("PR numbers are quiet mono references, and #5024 is a link", async ({
    page
  }) => {
    await page.goto("/blog/october-2025");
    const ref = page.locator("a.vx-ref", { hasText: "#5024" });
    await expect(ref).toHaveAttribute(
      "href",
      "https://github.com/vortex-data/vortex/pull/5024"
    );
    const style = await ref.evaluate((e) => {
      const s = getComputedStyle(e);
      return [s.textDecorationLine, s.fontFamily];
    });
    expect(style[0]).toBe("none");
    expect(style[1]).toMatch(/Geist Mono|mono/i);
  });
});

// Note 72: a post ends on its neighbours, one row of links and the sign-up.
test.describe("post ending", () => {
  test("btrblocks, the newest post, ends on the next older one by date", async ({
    page
  }) => {
    await page.goto("/blog/btrblocks-compressor");
    const nav = page.getByRole("navigation", { name: "Older and newer posts" });
    const prev = nav.locator('a[rel="prev"]');
    await expect(prev).toHaveAttribute("href", "/blog/december-2025");
    await expect(prev.locator(".vx-label")).toHaveText("Previous");
    await expect(nav.locator('a[rel="next"]')).toHaveCount(0);
  });

  test("neighbours are the nearest own posts by date, never a post elsewhere", async ({
    page
  }) => {
    await page.goto("/blog/october-2025");
    const nav = page.getByRole("navigation", { name: "Older and newer posts" });
    await expect(nav.locator('a[rel="prev"]')).toHaveAttribute(
      "href",
      "/blog/september-2025"
    );
    const next = nav.locator('a[rel="next"]');
    await expect(next).toHaveAttribute("href", "/blog/november-2025");
    await expect(next.locator(".vx-label")).toHaveText("Next");
    // A post elsewhere is never a neighbour.
    await expect(nav.locator('a[href^="http"]')).toHaveCount(0);
  });

  test("one row of links: Slack, the post's file on GitHub, and the feed", async ({
    page
  }) => {
    await page.goto("/blog/october-2025");
    const links = page.getByRole("navigation", { name: "About this post" });
    await expect(
      links.getByRole("link", { name: "Discuss in Slack" })
    ).toHaveAttribute("href", "/slack");
    await expect(
      links.getByRole("link", { name: "Edit on GitHub" })
    ).toHaveAttribute(
      "href",
      "https://github.com/vortex-data/vortex.dev/blob/main/src/content/blog/october-2025.mdx"
    );
    await expect(links.getByRole("link", { name: "RSS" })).toHaveAttribute(
      "href",
      "/rss/feed.xml"
    );
    await expect(page.getByLabel("Email address")).toHaveCount(1);
  });

  test("Subscribe looks enabled before an address is typed", async ({
    page
  }) => {
    await page.goto("/blog");
    const button = page.getByRole("button", { name: "Subscribe" });
    await expect(button).toBeEnabled();
    expect(await button.evaluate((e) => getComputedStyle(e).opacity)).toBe("1");
  });

  test("btrblocks: the first-published note closes the post, and the citation has no stray >", async ({
    page
  }) => {
    await page.goto("/blog/btrblocks-compressor");
    const prose = page.locator(".vx-prose");
    const note = prose.locator("> p.vx-article-note");
    await expect(note).toHaveText(/originally posted on the/);
    await expect(note.locator("a")).toHaveAttribute(
      "href",
      /cascading-compression-with-btrblocks/
    );
    // It is the prose's last child, not its first.
    expect(
      await prose.evaluate((e) =>
        e.lastElementChild?.classList.contains("vx-article-note")
      )
    ).toBe(true);
    await expect(prose.locator(".vx-callout").first()).not.toContainText("> ");
  });

  test("on a phone the post drops its card's edge, so the text gets the width", async ({
    page
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/blog/october-2025");
    const style = await page.locator("article.vx-article").evaluate((e) => {
      const s = getComputedStyle(e);
      return [s.borderTopWidth, s.paddingLeft];
    });
    expect(style).toEqual(["0px", "0px"]);
  });
});

// Note 75: every heading in a post can be linked to.
test.describe("heading anchors", () => {
  test("each heading has an id and links to itself, and its # shows on hover", async ({
    page
  }) => {
    await page.goto("/blog/btrblocks-compressor");
    const heading = page.getByRole("heading", {
      level: 2,
      name: "How Parquet does it"
    });
    await expect(heading).toHaveAttribute("id", "how-parquet-does-it");
    const link = heading.locator("a.vx-heading-link");
    await expect(link).toHaveAttribute("href", "#how-parquet-does-it");
    const mark = link.locator(".vx-anchor");
    const opacity = () => mark.evaluate((e) => getComputedStyle(e).opacity);
    expect(await opacity()).toBe("0");
    await heading.hover();
    await expect.poll(opacity).toBe("1");
    const ids = await page
      .locator(".vx-prose :is(h2, h3, h4)")
      .evaluateAll((hs) => hs.map((h) => h.id));
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("the # shows on keyboard focus, and a fragment lands on its heading", async ({
    page,
    browserName
  }) => {
    test.skip(browserName !== "chromium", "Tab order is Chromium's");
    await page.goto("/blog/btrblocks-compressor#sampling");
    const heading = page.locator("#sampling");
    await expect(heading).toBeInViewport();
    await heading.locator("a").focus();
    await expect
      .poll(() =>
        heading
          .locator(".vx-anchor")
          .evaluate((e) => getComputedStyle(e).opacity)
      )
      .toBe("1");
  });
});
