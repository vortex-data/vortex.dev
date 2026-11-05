import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Footer } from "@/components/layout/footer";
import { Header } from "@/components/layout/header";

// The star count is a fetch to GitHub; without it the button names the repository alone.
globalThis.fetch = (() =>
  Promise.reject(new Error("offline"))) as unknown as typeof fetch;

describe("Footer", () => {
  it("links the charter on the site by its path", () => {
    assert.match(renderToStaticMarkup(<Footer />), /href="\/charter.pdf"/);
  });

  // bench is served from its own host, where the site's paths are bench's.
  it("links the charter on the site from another host", () => {
    assert.match(
      renderToStaticMarkup(<Footer origin="https://vortex.dev" />),
      /href="https:\/\/vortex.dev\/charter.pdf"/
    );
  });

  it("is the same footer on every surface, over one solid rule", () => {
    const want = /^<footer class="vx-footer">/;
    assert.match(renderToStaticMarkup(<Footer />), want);
    assert.match(
      renderToStaticMarkup(<Footer origin="https://vortex.dev" />),
      want
    );
  });

  // Will, 4 Nov 2026: "switcher to footer is right". The switch is the footer's last item.
  it("ends with the theme switch, after the links", () => {
    for (const html of [
      renderToStaticMarkup(<Footer />),
      renderToStaticMarkup(<Footer origin="https://vortex.dev" />)
    ])
      assert.match(
        html,
        /<\/nav><fieldset class="vx-theme-switch" aria-label="Theme"[^>]*>.*<\/fieldset><\/footer>$/
      );
  });
});

describe("Header on bench", () => {
  it("links the wordmark to the site and marks Bench current", async () => {
    const html = renderToStaticMarkup(await Header({ bench: { home: "/" } }));
    assert.match(
      html,
      /<a href="https:\/\/vortex.dev" aria-label="Vortex home">/
    );
    // Outside a router there is no pathname: navLinks' tests pin "page" and "true".
    assert.match(html, /href="\/" aria-current="(page|true)">Bench</);
    assert.match(html, /href="https:\/\/vortex.dev\/blog">Blog</);
    assert.match(html, /aria-label="vortex-data\/vortex on GitHub"/);
  });

  it("does not wait for GitHub's star count before it renders on bench", async () => {
    const realFetch = globalThis.fetch;
    // A GitHub API that never answers: the bench header must still render, without a count.
    globalThis.fetch = (() => new Promise(() => {})) as typeof fetch;
    try {
      const header = await Promise.race([
        Header({ bench: { home: "/" } }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 500))
      ]);
      assert.notEqual(
        header,
        null,
        "the bench header waited for the star count"
      );
      const html = renderToStaticMarkup(header);
      assert.match(html, /aria-label="vortex-data\/vortex on GitHub"/);
      assert.doesNotMatch(html, /vx-btn-count/);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  // Design system DECISIONS 35: one header on every surface. A surface adds only its tools.
  it("draws the same header on the site and on bench", async () => {
    const want = /^<header class="vx-header"><div class="vx-header-start">/;
    assert.match(
      renderToStaticMarkup(await Header({ bench: { home: "/" } })),
      want
    );
    assert.match(renderToStaticMarkup(await Header()), want);
  });

  // Will, 4 Nov 2026: Slack's text link becomes its mark, "right next to the GitHub octocat", with
  // X beside it: the socials, together.
  it("ends every header with the socials and the Menu, and their twin rows in the panel", async () => {
    for (const [html, slack] of [
      [renderToStaticMarkup(await Header()), "/slack"],
      [
        renderToStaticMarkup(await Header({ bench: { home: "/" } })),
        "https://vortex.dev/slack"
      ]
    ] as const) {
      const x = "https://x.com/vortexdotdev";
      assert.match(
        html,
        new RegExp(
          `<div class="vx-header-end"><div class="vx-header-social"><a class="vx-nav-link vx-header-social-link" href="${x}" aria-label="Vortex on X" title="Vortex on X"><svg[^>]*>.*?</svg></a><a class="vx-nav-link vx-header-social-link" href="${slack}" aria-label="Vortex on Slack" title="Vortex on Slack"><svg[^>]*>.*?</svg></a>(<!--\\$\\?--><template[^>]*></template>)?<a class="vx-btn vx-btn-secondary is-mono vx-header-github"`
        )
      );
      assert.doesNotMatch(html, /vx-nav-link" href="[^"]*">Slack</);
      assert.doesNotMatch(html, /vx-theme-switch|>Theme</);
      assert.match(
        html,
        new RegExp(
          `>Blog</a><a class="vx-label vx-nav-link vx-header-menu-spill is-social" href="https://github.com/vortex-data/vortex" aria-label="vortex-data/vortex on GitHub">GitHub<svg[^>]*>.*?</svg></a><a class="vx-label vx-nav-link vx-header-menu-spill is-social is-icon" href="${slack}" aria-label="Vortex on Slack">Slack<svg[^>]*>.*?</svg></a><a class="vx-label vx-nav-link vx-header-menu-spill is-social is-icon" href="${x}" aria-label="Vortex on X">X<svg`
        )
      );
      assert.doesNotMatch(
        html,
        /<h1|vx-header-spill|vx-header-label|has-nav|is-solid/
      );
    }
  });

  it("puts bench's controls in the tools, between the links and the end group", async () => {
    const html = renderToStaticMarkup(
      await Header({
        bench: { home: "/" },
        tools: <button type="button">Expand all</button>
      })
    );
    assert.match(
      html,
      /<\/nav><div class="vx-header-tools"><button type="button">Expand all<\/button><\/div><div class="vx-header-end">/
    );
    assert.doesNotMatch(
      renderToStaticMarkup(await Header()),
      /vx-header-tools/
    );
  });
});
