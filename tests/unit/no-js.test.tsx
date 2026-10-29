import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AsciiMark } from "@/components/ascii-mark";
import { InstallTabs } from "@/components/install-tabs";
import { LogoBanner } from "@/components/logo-banner";
import { installTabs } from "@/lib/install";

const css = readFileSync(
  new URL("../../src/app/globals.css", import.meta.url),
  "utf8"
);

/** The declarations of the rule whose selector is exactly `selector`. */
function rule(source: string, selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    source.match(new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`))?.[1] ??
    null
  );
}

describe("the homepage without JavaScript", () => {
  it("hides every control that needs JavaScript under the no-js root", () => {
    assert.match(
      rule(css, ".no-js [data-requires-js]") ?? "",
      /display:\s*none\s*!important/
    );
  });

  it("server-renders the AsciiMark's static symbol, which the live mark replaces", () => {
    const html = renderToStaticMarkup(<AsciiMark className="host" />);
    // Next.js gives the symbol a URL; this test's loader may give none, so
    // the browser checks pin the src.
    assert.match(
      html,
      /^<div class="host" aria-hidden="true"><img class="ascii-mark-still"( src="[^"]*vortex_symbol[^"]*")? alt="" style="position:absolute;inset:0;margin:auto;width:40%;height:auto;opacity:0.85"\/><\/div>$/
    );
  });

  it("keeps every install command in reach: the tabs and copy hide, the panels stack under their names", () => {
    const html = renderToStaticMarkup(<InstallTabs sparkVersion="1.2.3" />);
    assert.match(html, /role="tablist"[^>]*data-requires-js="true"/);
    assert.match(html, /class="vx-copy"[^>]*data-requires-js="true"/);
    for (const tab of installTabs("1.2.3"))
      assert.ok(html.includes(`data-label="${tab.label}"`), tab.label);
    assert.match(
      rule(css, ".no-js .vx-tabs-pre.is-idle") ?? "",
      /visibility:\s*visible/
    );
    assert.match(
      rule(css, ".no-js .vx-tabs-pre::before") ?? "",
      /content:\s*attr\(data-label\)/
    );
  });

  it("stills the logo banner, whose pause control cannot work, and hides the control", () => {
    const html = renderToStaticMarkup(<LogoBanner />);
    assert.match(html, /class="vx-logos-pause"[^>]*data-requires-js="true"/);
    assert.match(
      rule(css, ".no-js .vx-logos-track") ?? "",
      /animation:\s*none/
    );
  });
});
