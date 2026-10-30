import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatStars, getStarCount } from "@/lib/github";

// A stand-in for fetch that records its call and answers with `respond`.
function stub(respond: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return respond();
  }) as typeof fetch;
  return { fake, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });

describe("formatStars", () => {
  it("writes the count as the header's GitHub button shows it, beside the star icon", () => {
    const CASES: [number, string][] = [
      [0, "0"],
      [950, "950"],
      [999, "999"],
      [1000, "1k"],
      [3286, "3.3k"],
      [3312, "3.3k"],
      [9960, "10k"],
      [12000, "12k"],
      [12600, "13k"]
    ];
    for (const [n, want] of CASES) assert.equal(formatStars(n), want, `${n}`);
  });
});

describe("getStarCount", () => {
  it("reads stargazers_count from the repository, cached for a day", async () => {
    const { fake, calls } = stub(() => json({ stargazers_count: 3312 }));
    assert.equal(await getStarCount(fake), 3312);
    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.equal(call?.url, "https://api.github.com/repos/vortex-data/vortex");
    const init = call?.init as RequestInit & { next?: { revalidate?: number } };
    assert.equal(init.next?.revalidate, 86400);
    assert.ok(init.signal instanceof AbortSignal, "the request has a timeout");
  });

  it("gives null when GitHub answers with an error", async () => {
    const { fake } = stub(() => json({ message: "rate limited" }, 403));
    assert.equal(await getStarCount(fake), null);
  });

  it("gives null when the request fails", async () => {
    const { fake } = stub(() => {
      throw new TypeError("fetch failed");
    });
    assert.equal(await getStarCount(fake), null);
  });

  it("gives null when the payload has no usable count", async () => {
    for (const body of [
      {},
      { stargazers_count: "3312" },
      { stargazers_count: -1 },
      { stargazers_count: 1.5 },
      null
    ]) {
      const { fake } = stub(() => json(body));
      assert.equal(await getStarCount(fake), null, JSON.stringify(body));
    }
  });

  it("gives null when the body is not JSON", async () => {
    const { fake } = stub(() => new Response("<html>", { status: 200 }));
    assert.equal(await getStarCount(fake), null);
  });
});
