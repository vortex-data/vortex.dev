import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { jsonLdScript } from "@/lib/json-ld";

describe("jsonLdScript", () => {
  it("escapes < so a value cannot close the script element", () => {
    const text = jsonLdScript({ headline: "a </script><b>" });
    assert.ok(!text.includes("<"));
    assert.equal(text, '{"headline":"a \\u003c/script>\\u003cb>"}');
    assert.deepEqual(JSON.parse(text), { headline: "a </script><b>" });
  });
});
