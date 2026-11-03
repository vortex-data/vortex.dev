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
});
