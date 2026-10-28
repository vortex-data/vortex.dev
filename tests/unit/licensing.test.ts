import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

// Third-party artwork keeps its own licence and copyright in the file that
// ships it, so REUSE and the built bundle carry the right notice.
const root = new URL("../../", import.meta.url);
const sources = ["src/", "bench/web/components/", "bench/web/app/"].flatMap(
  (dir) =>
    readdirSync(new URL(dir, root), { recursive: true, encoding: "utf8" })
      .filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."))
      .map((f) => `${dir}${f}`)
);
const read = (f: string) => readFileSync(new URL(f, root), "utf8");

// The patterns below name SPDX tags; REUSE must not read them as this file's own.
// REUSE-IgnoreStart
describe("third-party icons", () => {
  it("ship the Octicons GitHub mark only under its MIT notice", () => {
    for (const f of sources) {
      const code = read(f);
      if (!/M6\.766 11\.328|M8 0C3\.58 0 0 3\.58 0 8/.test(code)) continue;
      assert.match(code, /SPDX-License-Identifier: MIT/, f);
      assert.match(
        code,
        /SPDX-FileCopyrightText: Copyright \(c\) \d{4} GitHub Inc\./,
        f
      );
    }
  });

  it("credit Google for Material Symbols paths", () => {
    for (const f of sources) {
      const code = read(f);
      if (!code.includes('viewBox="0 -960 960 960"')) continue;
      assert.match(code, /SPDX-FileCopyrightText: Copyright Google LLC/, f);
    }
  });
});
// REUSE-IgnoreEnd
