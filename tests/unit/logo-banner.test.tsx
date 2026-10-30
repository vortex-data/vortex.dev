import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LogoBanner } from "@/components/logo-banner";
import { LOGOS } from "@/components/logo-banner/logos";

// The logos Will cleared for public use, in the Home card's order: the
// adopters and the projects that integrate Vortex. Spiral sits third, so it
// is in view on load. Dash0 replaced Polar Signals, which it acquired.
// Apache Iceberg is tagged "In proposal" until its Vortex support ships.
const CLEARED = [
  "Microsoft",
  "Palantir",
  "Spiral",
  "Firebolt",
  "Spice AI",
  "DatologyAI",
  "Dash0",
  "LangChain",
  "Milvus",
  "DuckDB",
  "Apache DataFusion",
  "Apache Arrow",
  "Apache Spark",
  "ClickHouse",
  "Apache Iceberg",
  "Apache Hudi",
  "Apache Paimon"
];

describe("LogoBanner", () => {
  it("shows the cleared adopters only, in the Home card's order", () => {
    assert.deepEqual(
      LOGOS.map((l) => l.name),
      CLEARED
    );
    for (const name of ["Google", "Polar Signals"])
      assert.ok(!LOGOS.some((l) => l.name.includes(name)), name);
  });

  it("names each logo once, and hides the loop's copies from assistive technology", () => {
    const html = renderToStaticMarkup(<LogoBanner />);
    const sets = html.split('<div class="vx-logos-set"').slice(1);
    assert.equal(sets.length, 2);
    const alts = (s: string) =>
      [...s.matchAll(/alt="([^"]*)"/g)].map((m) => m[1]);
    assert.deepEqual(alts(sets[0] ?? ""), CLEARED);
    assert.ok(sets[1]?.startsWith(' aria-hidden="true"'));
    assert.deepEqual(
      alts(sets[1] ?? ""),
      CLEARED.map(() => "")
    );
  });

  it("tags Apache Iceberg, and only Iceberg, as in proposal", () => {
    const html = renderToStaticMarkup(<LogoBanner />);
    const first = html.split('<div class="vx-logos-set"')[1] ?? "";
    const soon = [
      ...first.matchAll(
        /<a class="is-soon"[^>]*><img[^>]*alt="([^"]*)"[^>]*\/><span class="vx-label-sm vx-logos-soon">In proposal<\/span><\/a>/g
      )
    ].map((m) => m[1]);
    assert.deepEqual(soon, ["Apache Iceberg"]);
    assert.equal(first.match(/vx-logos-soon/g)?.length, 1);
  });

  // WCAG 2.2.2: the loop lasts over 5 seconds, so it has a pause control,
  // drawn as the design system's LogoBanner card draws it.
  it("has a pause toggle after its label, not pressed at first", () => {
    const html = renderToStaticMarkup(<LogoBanner />);
    const head = html.match(
      /<span class="vx-label">Ecosystem<\/span>(<button[\s\S]*?<\/button>)<div class="vx-logos-strip">/
    )?.[1];
    assert.ok(head, "the control sits between the label and the strip");
    assert.match(head, /^<button class="vx-logos-pause"/);
    assert.match(head, /type="button"/);
    assert.match(head, /aria-pressed="false"/);
    assert.match(head, /aria-label="Pause the logos"/);
    assert.equal(head.match(/<svg [^>]*aria-hidden="true"/g)?.length, 2);
  });
});

// The patterns below name SPDX tags; REUSE must not read them as this file's own.
// REUSE-IgnoreStart
// REUSE.toml's annotations, in order: a file takes the last one that names it.
const REUSE = readFileSync(new URL("../../REUSE.toml", import.meta.url), "utf8")
  .split("[[annotations]]")
  .slice(1)
  .map((block) => ({
    paths: [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]),
    holder: block.match(/SPDX-FileCopyrightText = "([^"]+)"/)?.[1],
    license: block.match(/SPDX-License-Identifier = "([^"]+)"/)?.[1]
  }));

describe("adopters' logos", () => {
  it("are each annotated as their owner's, not the project's", () => {
    const dir = new URL("../../src/assets/logos/", import.meta.url);
    const files = readdirSync(dir);
    assert.equal(files.length, CLEARED.length);
    for (const f of files) {
      const path = `src/assets/logos/${f}`;
      const entry = REUSE.findLast((a) => a.paths.includes(path));
      assert.equal(entry?.license, "LicenseRef-Third-Party", path);
      assert.ok(entry?.holder, path);
      assert.doesNotMatch(entry.holder, /Vortex/, path);
    }
  });
});
// REUSE-IgnoreEnd
