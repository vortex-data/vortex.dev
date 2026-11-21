import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

// The browser tests (ci.yml) and axe (lighthouse.yml) run in one Playwright
// image. Its browsers must match the installed @playwright/test, so the tag
// names that version, and a digest pins the image.
const IMAGE =
  /^\s*PLAYWRIGHT_IMAGE: (mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-[a-z]+@sha256:[a-f0-9]{64})\s*$/gm;

function images(path: string): { image: string; version: string }[] {
  return [...readFileSync(path, "utf8").matchAll(IMAGE)].map((match) => ({
    image: match[1] ?? "",
    version: match[2] ?? ""
  }));
}

describe("the Playwright image", () => {
  const ci = images(".github/workflows/ci.yml");
  const lighthouse = images(".github/workflows/lighthouse.yml");
  const installed = (
    createRequire(import.meta.url)("@playwright/test/package.json") as {
      version: string;
    }
  ).version;

  it("is pinned by digest once in each workflow", () => {
    assert.equal(
      ci.length,
      1,
      "ci.yml sets PLAYWRIGHT_IMAGE once, with a tag and a digest."
    );
    assert.equal(
      lighthouse.length,
      1,
      "lighthouse.yml sets PLAYWRIGHT_IMAGE once, with a tag and a digest."
    );
  });

  it("is the same image in both workflows", () => {
    assert.equal(lighthouse[0]?.image, ci[0]?.image);
  });

  it("carries the browsers of the installed @playwright/test", () => {
    assert.equal(ci[0]?.version, installed);
  });
});
