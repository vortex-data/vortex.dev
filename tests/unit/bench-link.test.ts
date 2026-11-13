import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { benchHref } from "@/lib/bench-link";

describe("benchHref", () => {
  it("names bench.vortex.dev on production", () => {
    assert.equal(benchHref("", "production"), "https://bench.vortex.dev");
    assert.equal(benchHref("/", "production"), "https://bench.vortex.dev/");
    assert.equal(
      benchHref("/methodology", "production"),
      "https://bench.vortex.dev/methodology"
    );
  });

  it("stays on the deployment's /bench everywhere else", () => {
    for (const env of ["preview", "development", "", undefined]) {
      assert.equal(benchHref("", env), "/bench");
      assert.equal(benchHref("/", env), "/bench");
      assert.equal(benchHref("/methodology", env), "/bench/methodology");
    }
  });

  it("refuses a path that is not root-relative", () => {
    assert.throws(() => benchHref("methodology", "production"));
  });
});
