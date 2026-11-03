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

  it("draws the frame's dashed rule on the site and a solid one on bench", () => {
    assert.match(
      renderToStaticMarkup(<Footer />),
      /^<footer class="vx-footer">/
    );
    assert.match(
      renderToStaticMarkup(<Footer origin="https://vortex.dev" solid />),
      /^<footer class="vx-footer is-solid">/
    );
  });
});

describe("Header on bench", () => {
  it("links the wordmark to the site and marks Bench current, with no ThemeSwitch", async () => {
    const html = renderToStaticMarkup(await Header({ bench: { home: "/" } }));
    assert.match(
      html,
      /<a href="https:\/\/vortex.dev" aria-label="Vortex home">/
    );
    // Outside a router there is no pathname: navLinks' tests pin "page" and "true".
    assert.match(html, /href="\/" aria-current="(page|true)">Bench</);
    assert.match(html, /href="https:\/\/vortex.dev\/blog">Blog</);
    assert.doesNotMatch(html, /vx-theme-switch/);
    assert.match(html, /aria-label="vortex-data\/vortex on GitHub"/);
  });

  it("draws solid rules on bench, and the frame's dashed ones on the site", async () => {
    assert.match(
      renderToStaticMarkup(await Header({ bench: { home: "/" } })),
      /^<header class="vx-header has-nav has-tools is-solid">/
    );
    assert.match(
      renderToStaticMarkup(await Header()),
      /^<header class="vx-header has-nav">/
    );
  });

  // The system's tools variant: one row with bench's title, its controls and its toggle, and on
  // a phone the GitHub button and the toggle as rows in the Menu's panel.
  it("puts bench's title, controls and toggle on the row, with their Menu rows", async () => {
    const html = renderToStaticMarkup(
      await Header({
        bench: { home: "/" },
        tools: <button type="button">Expand all</button>,
        theme: <button type="button">Dark</button>,
        themeRow: <button type="button">Dark theme</button>
      })
    );
    assert.match(
      html,
      /<\/a><h1 class="vx-label vx-header-label">Benchmarks<\/h1><\/div>/
    );
    assert.match(
      html,
      /<div class="vx-header-tools"><button type="button">Expand all<\/button><\/div><div class="vx-header-end"><button type="button">Dark<\/button><a class="vx-btn vx-btn-secondary is-mono vx-header-spill"/
    );
    assert.match(
      html,
      />Slack<\/a><a class="vx-label vx-nav-link vx-header-menu-spill" href="https:\/\/github.com\/vortex-data\/vortex"><svg[^<]*<path[^>]*><\/path><\/svg>GitHub<\/a><button type="button">Dark theme<\/button><\/nav><\/details>/
    );
  });

  it("gives the site's header none of bench's slots", async () => {
    const html = renderToStaticMarkup(await Header());
    assert.doesNotMatch(
      html,
      /<h1|vx-header-tools|vx-header-spill|vx-header-menu-spill/
    );
  });
});
