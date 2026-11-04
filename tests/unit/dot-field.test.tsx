import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DotField } from "@/components/dot-field";
import { NotFoundStatus } from "@/components/not-found";

// The design system's DotField: the mark's dot field, still, behind the 404 and the blog.
describe("DotField", () => {
  it("is decoration, hidden from assistive technology", () => {
    assert.equal(
      renderToStaticMarkup(<DotField />),
      '<div class="vx-dot-field" aria-hidden="true"></div>'
    );
  });

  it("keeps the margins at full strength around a column of text", () => {
    assert.equal(
      renderToStaticMarkup(<DotField margins />),
      '<div class="vx-dot-field is-margins" aria-hidden="true"></div>'
    );
  });

  it("lies first under the 404's Status card, which hosts it", () => {
    assert.match(
      renderToStaticMarkup(<NotFoundStatus />),
      /^<div class="vx-status has-mark has-dot-field"><div class="vx-dot-field" aria-hidden="true"><\/div><div class="vx-status-text">/
    );
  });
});
