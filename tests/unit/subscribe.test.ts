import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { POST } from "@/app/(site)/api/subscribe/route";
import { defined } from "@/lib/defined";

const ORIGIN = "https://vortex.dev";

// The rate limit keeps its counts per IP in the module, for the whole file,
// so each request gets its own IP unless a test means to share one.
let nextIp = 0;
const freshIp = () => `192.0.2.${++nextIp}`;

function post(
  body: string,
  {
    ip = freshIp(),
    headers = {}
  }: { ip?: string; headers?: Record<string, string> } = {}
): NextRequest {
  return new NextRequest(`${ORIGIN}/api/subscribe`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      "x-real-ip": ip,
      ...headers
    },
    body
  });
}

const email = (address: unknown) => JSON.stringify({ email: address });

// The Resend SDK calls the global fetch. Each test that reaches it says what
// Resend answers; a test that should never reach it fails if it does.
const realFetch = globalThis.fetch;
let resendCalls: { url: string; body: string }[] = [];
function resendAnswers(status: number, json: unknown): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    resendCalls.push({ url: String(input), body: String(init?.body ?? "") });
    return new Response(JSON.stringify(json), {
      status,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;
}

// Resend's SDK logs the errors it receives; keep the test output clean.
const realError = console.error;

beforeEach(() => {
  resendCalls = [];
  process.env.RESEND_API_KEY = "re_test";
  globalThis.fetch = (async () => {
    throw new Error("unexpected call to Resend");
  }) as typeof fetch;
  console.error = () => {};
});

afterEach(() => {
  globalThis.fetch = realFetch;
  console.error = realError;
  delete process.env.RESEND_API_KEY;
});

describe("POST /api/subscribe", () => {
  it("subscribes a valid address, lowercased", async () => {
    resendAnswers(200, { object: "contact", id: "c_1" });
    const res = await POST(post(email("Ada@Example.com")));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { success: true });
    assert.equal(resendCalls.length, 1);
    assert.equal(
      JSON.parse(defined(resendCalls[0]).body).email,
      "ada@example.com"
    );
  });

  it("answers an existing contact as it answers a new one", async () => {
    resendAnswers(422, {
      name: "validation_error",
      message: "Contact already exists"
    });
    const res = await POST(post(email("ada@example.com")));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { success: true });
  });

  it("does not pass on Resend's other errors", async () => {
    resendAnswers(422, { name: "validation_error", message: "secret detail" });
    const res = await POST(post(email("ada@example.com")));
    assert.equal(res.status, 500);
    assert.ok(!JSON.stringify(await res.json()).includes("secret detail"));
  });

  it("refuses a post from another origin, or with no origin", async () => {
    const cross = await POST(
      post(email("ada@example.com"), {
        headers: { origin: "https://evil.example" }
      })
    );
    assert.equal(cross.status, 403);
    const http = await POST(
      post(email("ada@example.com"), {
        headers: { origin: "http://vortex.dev" }
      })
    );
    assert.equal(http.status, 403);
    const request = post(email("ada@example.com"));
    request.headers.delete("origin");
    assert.equal((await POST(request)).status, 403);
  });

  it("accepts a same-origin Referer when Origin is missing", async () => {
    resendAnswers(200, { object: "contact", id: "c_2" });
    const request = post(email("ada@example.com"), {
      headers: { referer: `${ORIGIN}/blog/a-post` }
    });
    request.headers.delete("origin");
    assert.equal((await POST(request)).status, 200);
  });

  it("limits each IP to ten requests per window", async () => {
    const ip = freshIp();
    for (let i = 0; i < 10; i++) {
      const res = await POST(post("not json", { ip }));
      assert.equal(res.status, 400);
    }
    const limited = await POST(post("not json", { ip }));
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
    assert.equal((await POST(post("not json"))).status, 400);
  });

  it("refuses a body over 1 KiB, declared or not", async () => {
    // A declared size over the limit fails before the body is read, so a
    // small body with a large Content-Length is refused too.
    const declared = post(email("ada@example.com"), {
      headers: { "content-length": "2048" }
    });
    assert.equal((await POST(declared)).status, 413);
    // NextRequest sets no Content-Length for a string body, so this request
    // reaches the read that counts the bytes.
    const big = email(`${"a".repeat(1100)}@example.com`);
    assert.equal((await POST(post(big))).status, 413);
  });

  it("is unavailable without a Resend key", async () => {
    delete process.env.RESEND_API_KEY;
    assert.equal((await POST(post(email("ada@example.com")))).status, 503);
  });

  it("rejects a body that is not an address", async () => {
    for (const body of [
      "not json",
      "{}",
      email(42),
      email("no-at-sign"),
      email("ada@localhost"),
      email("a b@example.com"),
      email(`${"a".repeat(250)}@example.com`)
    ]) {
      const res = await POST(post(body));
      assert.equal(res.status, 400, body);
    }
  });
});
