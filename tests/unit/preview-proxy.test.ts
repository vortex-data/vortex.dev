import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  createServer,
  get as httpGet,
  type IncomingHttpHeaders,
  type Server
} from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { afterEach, describe, it } from "node:test";
import {
  destination,
  previewProxy,
  readSecret
} from "../../scripts/preview-proxy.mjs";

const loopback = { allowLoopback: true };
const deployment = "https://vortex-abc123-vortex-data.vercel.app";

// node:http, not fetch: bun runs every test file in one process, and another
// file replaces globalThis.fetch with a stub that rejects. http.get also
// leaves a redirect unfollowed.
function request(
  url: string
): Promise<{ headers: IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    httpGet(url, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        body += chunk;
      });
      response.on("end", () => resolve({ headers: response.headers, body }));
    }).on("error", reject);
  });
}

const servers: Server[] = [];
async function listen(server: Server) {
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((done) => {
          server.closeAllConnections();
          server.close(() => done());
        })
    )
  );
});

describe("preview proxy", () => {
  it("sends the bypass and toolbar headers only upstream, and drops x-robots-tag", async () => {
    let headers: Record<string, unknown> = {};
    const target = await listen(
      createServer((request, response) => {
        headers = request.headers;
        response.setHeader("x-robots-tag", "noindex");
        response.end("preview");
      })
    );
    const proxy = await listen(
      previewProxy(target, "fixture-secret", loopback)
    );
    const response = await request(`${proxy}/bench`);
    assert.equal(response.body, "preview");
    assert.equal(headers["x-vercel-protection-bypass"], "fixture-secret");
    assert.equal(headers["x-vercel-skip-toolbar"], "1");
    assert.equal(headers.host, new URL(target).host);
    assert.equal(response.headers["x-robots-tag"], undefined);
    assert.equal(response.headers["x-vercel-protection-bypass"], undefined);
  });

  it("keeps a preview redirect on the proxy and a foreign redirect as it is", async () => {
    const target = await listen(
      createServer((request, response) => {
        response.writeHead(308, {
          Location:
            request.url === "/local"
              ? `${target}/blog?x=1`
              : "https://example.com/"
        });
        response.end();
      })
    );
    const proxy = await listen(
      previewProxy(target, "fixture-secret", loopback)
    );
    const local = await request(`${proxy}/local`);
    assert.equal(local.headers.location, `${proxy}/blog?x=1`);
    const foreign = await request(`${proxy}/foreign`);
    assert.equal(foreign.headers.location, "https://example.com/");
  });

  it("forwards only to an HTTPS Vercel deployment", () => {
    assert.equal(destination(deployment).origin, deployment);
    for (const target of [
      // A loopback destination is for these tests only.
      "http://127.0.0.1:3000",
      "http://localhost:3000",
      "https://vercel.app",
      "https://vortex.evil.vercel.app",
      "https://vortex-abc123-vortex-data.vercel.app.example.com",
      "http://vortex-abc123-vortex-data.vercel.app",
      "https://vortex-abc123-vortex-data.vercel.app:8443",
      "https://vortex-abc123-vortex-data.vercel.app/path",
      "https://user@vortex-abc123-vortex-data.vercel.app",
      "https://example.com"
    ])
      assert.throws(
        () => destination(target),
        /Not a Vercel deployment origin/,
        target
      );
  });

  it("requires a secret that is safe in a header", () => {
    for (const secret of [undefined, null, "", "two words", "line\nbreak"])
      assert.throws(() =>
        previewProxy(deployment, secret as unknown as string)
      );
  });

  it("reads the secret without the shell's line break", async () => {
    assert.equal(
      await readSecret(Readable.from(["fixture-secret\n"])),
      "fixture-secret"
    );
    assert.equal(
      await readSecret(Readable.from(["fixture-secret"])),
      "fixture-secret"
    );
  });

  it("refuses to start with the secret in its environment", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/preview-proxy.mjs", "0", deployment],
      {
        env: {
          ...process.env,
          VERCEL_AUTOMATION_BYPASS_SECRET: "fixture-secret"
        },
        input: "fixture-secret",
        encoding: "utf8"
      }
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /without VERCEL_AUTOMATION_BYPASS_SECRET/);
  });
});
