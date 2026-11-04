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

  // Note 81: the hero says what Vortex is, above the fold. Home E2 sets it in
  // mono in the headline's 440px column, so it takes three lines.
  test("the standfirst says what Vortex is", async ({ page }) => {
    await page.setViewportSize({ width: 1512, height: 860 });
    await page.goto("/");
    const standfirst = page.getByText(
      "Vortex is an open-source columnar file format for fast scans, random access, and compression."
    );
    await expect(standfirst).toBeVisible();
    const box = await standfirst.boundingBox();
    expect(box?.height ?? 99).toBeLessThan(90);
    expect((box?.y ?? 999) + (box?.height ?? 0)).toBeLessThan(430);
  });

  // "pick three." takes the headline's second line whole, on a laptop and on
  // a large monitor alike.
  for (const [width, height] of [
    [1512, 860],
    [2560, 1400]
  ] as const) {
    test(`the headline breaks before "pick three." at ${width} × ${height}`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      const lines = await page.locator("h1").evaluate((h) => {
        const s = getComputedStyle(h);
        return Math.round(h.clientHeight / Number.parseFloat(s.lineHeight));
      });
      expect(lines).toBe(2);
      const h1 = await page.locator("h1").boundingBox();
      const keep = await page.locator("h1 span").boundingBox();
      expect(Math.round(keep?.x ?? 0)).toBe(Math.round(h1?.x ?? -1));
    });
  }

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
    // The last tab is Spark, or DataFusion when the Maven lookup fails.
    const last = page
      .getByRole("tablist", { name: "Install Vortex" })
      .getByRole("tab")
      .last();
    await page.keyboard.press("End");
    await expect(last).toBeFocused();
    await expect(last).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Home");
    await expect(tab("Rust")).toBeFocused();
    await expect(tab("Rust")).toHaveAttribute("tabindex", "0");
    await expect(last).toHaveAttribute("tabindex", "-1");
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
  test("the results table shows six benchmarks with a source link, or is absent", async ({
    page
  }) => {
    await page.goto("/");
    // The figures are read from bench.vortex.dev at build time. When that
    // read fails the page leaves the whole table out, never part of it.
    const table = page.getByRole("region", { name: "Benchmark results" });
    if ((await table.count()) === 0) {
      await expect(page.locator(".vx-results-table")).toHaveCount(0);
      return;
    }
    await expect(table).toBeVisible();
    await expect(table.locator("tbody tr")).toHaveCount(6);
    await expect(table.locator("tbody td.is-ours")).toHaveCount(6);
    await expect(table).toContainText(/read \d+ \w{3} \d{4}/);
    const source = table.locator('a[href="https://bench.vortex.dev"]');
    await expect(source).toBeVisible();
    await expect(source).toHaveText("bench.vortex.dev");
  });

  // Home E2: the model card's motif. Each row underlines its best figure,
  // which is mostly Vortex's, and says how Vortex does against Parquet.
  // Every cell keeps its full unit as its hover title. Lance cannot run in
  // cuDF, so it is N/A there, and the hand-kept GPU row names its source.
  test("each row marks its best figure, and every cell names its system and full unit", async ({
    page
  }) => {
    await page.goto("/");
    const table = page.getByRole("region", { name: "Benchmark results" });
    test.skip((await table.count()) === 0, "bench was not read at build");
    const rows = await table.locator("tbody tr").evaluateAll((trs) =>
      trs.map((tr) => ({
        name: tr.querySelector("th")?.firstChild?.textContent ?? "",
        best: tr.querySelectorAll("td.is-best").length,
        verdict: tr.querySelector("td.is-verdict")?.textContent ?? "",
        titles: [...tr.querySelectorAll("td:not(.is-verdict)")].map(
          (td) => td.getAttribute("title") ?? ""
        )
      }))
    );
    expect(rows.map((r) => r.name)).toEqual([
      "Scan",
      "Write",
      "ClickBench",
      "GPU, cuDF",
      "Random access",
      "File size"
    ]);
    for (const r of rows) {
      expect(r.best, r.name).toBeGreaterThanOrEqual(1);
      expect(r.verdict, r.name).toMatch(
        /^(\d[\d.]*(×|%) (faster|slower|smaller|larger)|as fast|the same size|\w+ not measured)$/
      );
      for (const t of r.titles)
        expect(t, r.name).toMatch(/^(Vortex|Parquet|Lance|Arrow): \S/);
    }
    await expect(
      table.locator('td[title="Lance: not available, no cuDF integration"]')
    ).toHaveText("N/A");
    await expect(
      table.locator('tbody th[title^="end to end, hot, "]')
    ).toContainText("GPU, cuDF");
  });

  // The exact list and order are logo-banner.test.tsx's; here the page shows
  // them, so adding a logo changes only that test.
  test("the logo banner shows the cleared logos, Spiral third", async ({
    page
  }) => {
    await page.goto("/");
    const banner = page.getByRole("region", { name: "Ecosystem" });
    await expect(banner).toBeVisible();
    // Only the first set is named; the loop's copies are hidden.
    const names = await banner
      .getByRole("img")
      .evaluateAll((imgs) => imgs.map((i) => i.getAttribute("alt")));
    expect(names.length).toBeGreaterThanOrEqual(16);
    expect(names.slice(0, 3)).toEqual(["Microsoft", "Palantir", "Spiral"]);
    expect(new Set(names).size).toBe(names.length);
    await expect(
      banner.getByRole("link", { name: "Apache Iceberg In proposal" })
    ).toHaveClass("is-soon");
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
  test("one list per year, newest first, mixes own posts with posts elsewhere", async ({
    page
  }) => {
    await page.goto("/blog");
    // Note 81: a quiet mono h2 per year over that year's own list.
    const years = page.locator("h2.vx-label.vx-posts-year");
    const yearTexts = await years.allTextContents();
    expect(yearTexts.length).toBeGreaterThanOrEqual(2);
    expect([...yearTexts].sort().reverse()).toEqual(yearTexts);
    await expect(page.locator("ul.vx-posts")).toHaveCount(yearTexts.length);
    for (const year of yearTexts) {
      const list = page.locator(`h2#posts-${year} + ul.vx-posts`);
      const inList = await list
        .locator(".vx-post-row-meta time")
        .evaluateAll((ts) => ts.map((t) => t.getAttribute("datetime") ?? ""));
      expect(inList.length).toBeGreaterThan(0);
      for (const d of inList)
        expect(String(new Date(d).getUTCFullYear())).toBe(year);
    }
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
    // On a phone the links are behind the Menu button.
    const menu = page.locator(".vx-header-menu > summary");
    if (await menu.isVisible()) await menu.click();
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
    // repository name is certain. The button and its twin row in the Menu
    // share the address: one of them shows at any width.
    const github = page
      .locator('header a[href="https://github.com/vortex-data/vortex"]')
      .filter({ visible: true });
    await expect(github).toHaveCount(1);
    await expect(github).toHaveAccessibleName(/^vortex-data\/vortex/);
  });
});

test.describe("header menu on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("the links are behind the Menu button, which opens and closes", async ({
    page
  }) => {
    await page.goto("/");
    const menu = page.locator(".vx-header-menu");
    const button = menu.locator("summary");
    await expect(page.locator(".vx-header-nav")).toBeHidden();
    await expect(button).toBeVisible();
    await expect(button).toHaveAccessibleName("Menu");
    const panel = menu.getByRole("navigation", { name: "Primary" });
    await expect(panel).toBeHidden();
    await button.click();
    await expect(panel.getByRole("link", { name: "Docs" })).toBeVisible();
    // The panel is on the page's ground, not a grey of its own.
    const [panelBg, pageBg] = await panel.evaluate((el) => [
      getComputedStyle(el).backgroundColor,
      getComputedStyle(document.body).backgroundColor
    ]);
    expect(panelBg).toBe(pageBg);
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(button).toBeFocused();
    await button.click();
    await page.mouse.click(180, 600);
    await expect(panel).toBeHidden();
  });

  test("a link in the menu closes it on the new page", async ({ page }) => {
    await page.goto("/");
    await page.locator(".vx-header-menu > summary").click();
    await page
      .locator(".vx-header-menu")
      .getByRole("link", { name: "Blog" })
      .click();
    await page.waitForURL("/blog");
    await expect(page.locator(".vx-header-menu")).not.toHaveAttribute(
      "open",
      ""
    );
  });

  for (const [width, path] of [
    [320, "/"],
    [320, "/blog"],
    [375, "/blog"]
  ] as const) {
    test(`the header keeps one row at ${width}px on ${path}`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 640 });
      await page.goto(path);
      const header = await page.locator(".vx-header").boundingBox();
      expect(header?.height).toBe(64);
      const end = await page.locator(".vx-header-end").boundingBox();
      expect((end?.x ?? 0) + (end?.width ?? 999)).toBeLessThanOrEqual(
        width - 16
      );
    });
  }
});

test.describe("header menu without scripts", () => {
  test.use({ viewport: { width: 375, height: 812 }, javaScriptEnabled: false });

  test("opens, as a <details>", async ({ page }) => {
    await page.goto("/");
    await page.locator(".vx-header-menu > summary").click();
    await expect(
      page.locator(".vx-header-menu").getByRole("link", { name: "Bench" })
    ).toBeVisible();
  });
});

// On a phone the switch is a row in the Menu's panel: open it first.
async function openMenuOnPhone(page: Page) {
  const menu = page.locator(".vx-header-menu > summary");
  if (await menu.isVisible()) await menu.click();
}

test.describe("theme switch", () => {
  // DECISIONS 37 and 43: every surface has the switch and defaults to Dark, even when the OS
  // prefers Light.
  test("sets data-theme on the blog, and the choice survives a reload", async ({
    page
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/blog");
    await openMenuOnPhone(page);
    const html = page.locator("html");
    const choice = (name: string) =>
      page
        .getByRole("group", { name: "Theme" })
        .filter({ visible: true })
        .getByRole("button", { name });
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(choice("Dark")).toHaveAttribute("aria-pressed", "true");
    await choice("Light").click();
    await expect(html).toHaveAttribute("data-theme", "light");
    await expect(choice("Light")).toHaveAttribute("aria-pressed", "true");
    await expect(choice("Dark")).toHaveAttribute("aria-pressed", "false");
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "light");
    await openMenuOnPhone(page);
    await expect(choice("Light")).toHaveAttribute("aria-pressed", "true");
  });

  test("System follows the OS while the page stays open", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/blog");
    await openMenuOnPhone(page);
    const html = page.locator("html");
    await page
      .getByRole("group", { name: "Theme" })
      .filter({ visible: true })
      .getByRole("button", { name: "System" })
      .click();
    await expect(html).toHaveAttribute("data-theme", "light");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(html).toHaveAttribute("data-theme", "dark");
  });

  test("the homepage has the switch and follows a stored Light", async ({
    page
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.addInitScript(() => localStorage.setItem("vx-theme", "light"));
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await openMenuOnPhone(page);
    await expect(
      page.getByRole("group", { name: "Theme" }).filter({ visible: true })
    ).toHaveCount(1);
  });

  test("a client navigation from a Light blog to the homepage stays Light", async ({
    page
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.addInitScript(() => localStorage.setItem("vx-theme", "light"));
    await page.goto("/blog");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByRole("link", { name: "Vortex home" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });
});

test.describe("404", () => {
  test("an unknown path returns 404 with the code as its headline, the links and the mark", async ({
    page
  }) => {
    const res = await page.goto("/no-such-page");
    expect(res?.status()).toBe(404);
    const main = page.locator("main");
    // Writing › Site errors: the headline is the code, the sentence says what
    // it means, and no eyebrow repeats it.
    await expect(
      main.getByRole("heading", { level: 1, name: "404" })
    ).toHaveClass(/vx-status-code/);
    await expect(main.locator(".vx-status-sentence")).toHaveText(
      "Page not found."
    );
    await expect(main.locator(".vx-eyebrow")).toHaveCount(0);
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

// Home E2: on a phone the results table keeps Vortex's column and the
// verdict, and fits the screen down to 320px.
test.describe("results table on phones", () => {
  for (const width of [320, 375]) {
    test.describe(`at ${width}px`, () => {
      test.use({ viewport: { width, height: 812 } });

      test("shows Vortex and the verdict, inside the screen", async ({
        page
      }) => {
        await page.goto("/");
        const table = page.getByRole("region", { name: "Benchmark results" });
        test.skip((await table.count()) === 0, "bench was not read at build");
        await expect(
          table.locator(".vx-results-head > span").first()
        ).toHaveText("File format benchmarks");
        const m = await table.evaluate((el) => ({
          right: el.getBoundingClientRect().right,
          heads: [...el.querySelectorAll("thead th")]
            .filter((th) => getComputedStyle(th).display !== "none")
            .map((th) => th.textContent)
        }));
        expect(m.heads).toEqual(["Benchmark", "Vortex", "vs Parquet"]);
        expect(m.right).toBeLessThanOrEqual(width);
      });
    });
  }
});

// Home E2: from 1240px the mark fills the first screen, the hero ends at the
// screen's foot, and its four parts sit in its corners without touching.
test.describe("home fills the first screen", () => {
  for (const [width, height] of [
    [1280, 800],
    [1440, 900],
    [1512, 860]
  ] as const) {
    test(`at ${width} × ${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      const m = await page.evaluate(() => {
        const box = (s: string) => {
          const r = document.querySelector(s)?.getBoundingClientRect();
          return r
            ? { top: r.top, right: r.right, bottom: r.bottom, left: r.left }
            : null;
        };
        return {
          hero: box('main [class*="_hero"]'),
          mark: box('main [class*="_markHost"]'),
          head: box('main [class*="_head"]'),
          eyebrow: box(".vx-eyebrow"),
          install: box(".vx-tabs"),
          results: box(".vx-results"),
          logos: box(".vx-logos")
        };
      });
      const { hero, mark, head, eyebrow, install, results, logos } = m;
      if (!hero || !mark || !head || !eyebrow || !install || !logos)
        throw new Error("a part of the hero is missing");
      expect(Math.abs(hero.bottom - height)).toBeLessThanOrEqual(1);
      // The mark's host fills the hero up to the Home card's 820px, and is
      // centred in a taller one.
      expect(mark.bottom - mark.top).toBe(
        Math.min(hero.bottom - hero.top, 820)
      );
      expect(
        Math.abs(mark.top - hero.top - (hero.bottom - mark.bottom))
      ).toBeLessThanOrEqual(1);
      expect(mark.right - mark.left).toBe(hero.right - hero.left);
      // The corners.
      expect(head.left).toBeLessThan(eyebrow.left);
      expect(head.right).toBeLessThan(eyebrow.left);
      expect(install.top).toBeGreaterThan(head.bottom);
      expect(install.bottom).toBeLessThanOrEqual(height);
      if (results) {
        expect(results.left).toBeGreaterThan(install.right);
        expect(results.top).toBeGreaterThan(eyebrow.bottom);
        expect(results.bottom).toBeLessThanOrEqual(height);
      }
      // The LogoBanner is below the fold.
      expect(logos.top).toBeGreaterThanOrEqual(height);
    });
  }
});

// On a large monitor the logos and the footer fit on the first screen too,
// and the mark stops growing at 820px, so it stays clear of the words.
test.describe("home on a tall screen", () => {
  for (const [width, height] of [
    [1920, 1100],
    [2560, 1400]
  ] as const) {
    test(`fits the whole page at ${width} × ${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      const m = await page.evaluate(() => ({
        scroll: document.documentElement.scrollHeight - window.innerHeight,
        footer: document.querySelector("footer")?.getBoundingClientRect()
          .bottom,
        mark: document
          .querySelector('main [class*="_markHost"]')
          ?.getBoundingClientRect().height
      }));
      expect(m.scroll).toBeLessThanOrEqual(0);
      expect(m.footer).toBeLessThanOrEqual(height);
      expect(m.mark).toBeLessThanOrEqual(820);
    });
  }
});

// Home E2: without scripts, or without WebGL, there is no mark to look at.
// The words and the table share one compact screen, side by side, with the
// footer in view.
const compactHome = async (page: Page, width: number, height: number) => {
  await page.setViewportSize({ width, height });
  await page.goto("/");
  return page.evaluate(() => {
    const box = (s: string) =>
      document.querySelector(s)?.getBoundingClientRect() ?? null;
    return {
      scroll: document.documentElement.scrollHeight - window.innerHeight,
      mark: getComputedStyle(
        document.querySelector('main [class*="_markHost"]')?.parentElement ??
          document.body
      ).display,
      install: box(".vx-tabs"),
      results: box(".vx-results"),
      footer: box("footer")
    };
  });
};

test.describe("home without scripts", () => {
  test.use({ javaScriptEnabled: false });

  // Every install command shows, stacked under its tab's name, so this page
  // is taller than one screen. It still drops the mark and sets the table
  // beside the words.
  for (const [width, height] of [
    [1512, 860],
    [1280, 800]
  ] as const) {
    test(`drops the mark, with the table beside the words, at ${width} × ${height}`, async ({
      page
    }) => {
      const m = await compactHome(page, width, height);
      expect(m.mark).toBe("none");
      if (m.results)
        expect(m.results.left).toBeGreaterThan(m.install?.right ?? 9999);
    });
  }
});

test.describe("home without WebGL", () => {
  test("lays out without the mark from the first frame, so nothing moves", async ({
    page
  }) => {
    // A browser that cannot make a WebGL context, as with WebGL turned off.
    await page.addInitScript(() => {
      const real = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        kind: string,
        ...rest: unknown[]
      ) {
        if (/webgl/.test(kind)) return null;
        return (real as (...a: unknown[]) => unknown).call(this, kind, ...rest);
      } as typeof real;
      const w = window as unknown as { shift: number };
      w.shift = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries())
          w.shift += (e as unknown as { value: number }).value;
      }).observe({ type: "layout-shift", buffered: true });
    });
    const m = await compactHome(page, 1512, 860);
    await expect(page.locator("html")).toHaveClass(/\bno-webgl\b/);
    await expect(page.locator("[data-mark-mode]")).toHaveAttribute(
      "data-mark-mode",
      /static|error/
    );
    expect(m.mark).toBe("none");
    expect(m.scroll).toBeLessThanOrEqual(0);
    const shift = await page.evaluate(
      () => (window as unknown as { shift: number }).shift
    );
    expect(shift).toBeLessThan(0.01);
  });

  test("lays out without the mark when a link from another page opens it", async ({
    page
  }) => {
    // The first-paint script ran on /blog, so it did not probe; the link
    // renders the homepage in place, with no new document.
    await page.addInitScript(() => {
      const real = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        kind: string,
        ...rest: unknown[]
      ) {
        if (/webgl/.test(kind)) return null;
        return (real as (...a: unknown[]) => unknown).call(this, kind, ...rest);
      } as typeof real;
      // The mark's band's display when the homepage's DOM first goes in,
      // after React's layout effects and before the frame is painted.
      const w = window as unknown as { firstMark?: string };
      new MutationObserver((_, obs) => {
        const host = document.querySelector('main [class*="_markHost"]');
        if (!host?.parentElement) return;
        w.firstMark = getComputedStyle(host.parentElement).display;
        obs.disconnect();
      }).observe(document, { childList: true, subtree: true });
    });
    await page.setViewportSize({ width: 1512, height: 860 });
    await page.goto("/blog");
    await page.getByRole("link", { name: "Vortex home" }).click();
    await page.waitForURL("/");
    await expect(page.locator("html")).toHaveClass(/\bno-webgl\b/);
    expect(
      await page.evaluate(
        () => (window as unknown as { firstMark?: string }).firstMark
      )
    ).toBe("none");
  });
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

  // The page can have a few pixels of slack where the frame does not, so
  // a table wider than its frame would pass the scroll test on one font
  // renderer and fail on another.
  test("the results table fits inside its frame at 320px", async ({ page }) => {
    await page.goto("/");
    const frame = page.locator(".vx-results");
    test.skip((await frame.count()) === 0, "no benchmark figures");
    const { frameRight, tableRight } = await frame.evaluate((el) => {
      const table = el.querySelector(".vx-results-table");
      const padding = Number.parseFloat(getComputedStyle(el).paddingRight);
      return {
        frameRight: el.getBoundingClientRect().right - padding,
        tableRight: table?.getBoundingClientRect().right ?? 0
      };
    });
    expect(tableRight).toBeLessThanOrEqual(frameRight);
  });

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
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/blog");
    await page.evaluate(() => localStorage.setItem("vx-theme", "light"));
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    // A MutationObserver runs after React commits the new route but before
    // the browser paints it, so it sees the theme the first frame uses.
    await page.evaluate(() => {
      const w = window as unknown as { themeAtCommit?: string };
      new MutationObserver((_, observer) => {
        if (document.querySelector("h1.vx-display-mono")) {
          w.themeAtCommit = document.documentElement.dataset.theme ?? "";
          observer.disconnect();
        }
      }).observe(document.body, { childList: true, subtree: true });
    });
    await page.locator('header a[href="/"]').first().click();
    await expect(page.locator("h1.vx-display-mono")).toBeVisible();
    const theme = await page.evaluate(
      () => (window as unknown as { themeAtCommit?: string }).themeAtCommit
    );
    // The homepage follows the choice, as every page does (DECISIONS 37).
    expect(theme).toBe("light");
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
    const banner = page.getByRole("region", { name: "Ecosystem" });
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
    test(`shows every logo still at ${width}px`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      // The first set holds every logo; the loop's copies are hidden here.
      const set = page
        .getByRole("region", { name: "Ecosystem" })
        .locator(".vx-logos-set")
        .first();
      expect(await set.locator("img").count()).toBeGreaterThanOrEqual(16);
      // An "In proposal" tag hangs past its logo, so the tags are checked too.
      const marks = set.locator(":is(img, .vx-logos-soon)");
      for (const box of await marks.evaluateAll((els) =>
        els.map((e) => e.getBoundingClientRect().toJSON())
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
  // Audit, 30 Oct 2026: the switch's buttons reset with all: unset, which
  // beat the shared focus rule, so keyboard focus showed no ring.
  test("the theme switch shows the focus ring", async ({
    page,
    browserName
  }) => {
    test.skip(
      browserName === "webkit",
      "WebKit's Tab key skips buttons by default"
    );
    await page.goto("/blog");
    const button = page.locator(".vx-theme-switch button").first();
    await button.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(button).toBeFocused();
    expect(await button.evaluate((b) => getComputedStyle(b).outlineStyle)).toBe(
      "solid"
    );
  });

  const POST = "/blog/btrblocks-compressor";
  // A row's text starts with its meta (the date), which sits in its first column.
  const x = async (page: Page, selector: string) =>
    (await page.locator(selector).first().boundingBox())?.x ?? Number.NaN;

  test("each row's title is an h3 under its year, and its text is in line with the heading", async ({
    page
  }) => {
    await page.goto("/blog");
    const row = page.locator("ul.vx-posts > li > a.vx-post-row").first();
    await expect(row.locator("h3.vx-post-row-title")).toBeVisible();
    const gapYear =
      (await x(page, ".vx-posts-year")) - (await x(page, ".vx-blog-title"));
    expect(Math.abs(gapYear)).toBeLessThan(1);
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
    // On a phone the button leaves the row for its twin in the Menu.
    await openMenuOnPhone(page);
    await expect(
      page
        .locator('header a[href="https://github.com/vortex-data/vortex"]')
        .filter({ visible: true })
    ).toHaveAccessibleName(/^vortex-data\/vortex( [\d.]+k? stars)? on GitHub$/);
  });

  for (const [width, menu] of [
    [1000, false],
    [900, true]
  ] as const) {
    test(`the blog header ${menu ? "puts its links behind the menu" : "shows its links"} at ${width}px, and nothing overflows`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/blog");
      await expect(page.locator(".vx-header-nav")).toBeVisible({
        visible: !menu
      });
      await expect(page.locator(".vx-header-menu")).toBeVisible({
        visible: menu
      });
      expect((await page.locator(".vx-header").boundingBox())?.height).toBe(64);
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

// WCAG 2.4.1: a "Skip to content" link is the first tab stop on every page.
// It shows only while it has focus, and it moves focus to the page's main,
// with or without JavaScript, so the next Tab starts in the content.
test.describe("skip link", () => {
  for (const js of [true, false]) {
    test(`skips the header to the main content ${js ? "with" : "without"} JavaScript`, async ({
      browser,
      browserName
    }) => {
      test.skip(browserName !== "chromium", "Tab order is Chromium's");
      const context = await browser.newContext({ javaScriptEnabled: js });
      const page = await context.newPage();
      await page.goto("/blog");
      const skip = page.getByRole("link", { name: "Skip to content" });
      const width = async () => (await skip.boundingBox())?.width ?? 0;
      expect(await width()).toBeLessThanOrEqual(1);
      await page.keyboard.press("Tab");
      await expect(skip).toBeFocused();
      expect(await width()).toBeGreaterThan(40);
      await page.keyboard.press("Enter");
      await expect(page.locator("main#main")).toBeFocused();
      expect(await width()).toBeLessThanOrEqual(1);
      await page.keyboard.press("Tab");
      const inMain = await page.evaluate(
        () =>
          document.querySelector("main")?.contains(document.activeElement) ??
          false
      );
      expect(inMain).toBe(true);
      await context.close();
    });
  }
});
