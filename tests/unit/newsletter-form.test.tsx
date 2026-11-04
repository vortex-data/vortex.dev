import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NewsletterForm, subscribeError } from "@/components/newsletter-form";

describe("the newsletter form", () => {
  it("says what did not happen, then what to do, for every failure", () => {
    for (const status of [null, 400, 403, 413, 429, 500, 502, 503]) {
      const message = subscribeError(status);
      assert.match(
        message,
        /^You are not subscribed\. [A-Z][^.]*\.$/,
        String(status)
      );
    }
    assert.match(subscribeError(null), /connection/);
    assert.match(subscribeError(400), /address/);
    assert.match(subscribeError(429), /few minutes/);
  });

  it("puts its live region in the page empty, before any reply", () => {
    const html = renderToStaticMarkup(<NewsletterForm />);
    assert.match(html, /<p[^>]*role="status"[^>]*><\/p>/);
    assert.doesNotMatch(html, /\sdisabled(=|\s|>)/);
  });
});
