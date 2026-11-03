// Serve a protected Vercel deployment on 127.0.0.1, so Lighthouse and
// Playwright can audit a pull request's preview without holding its bypass
// secret.
//
//   VERCEL_AUTOMATION_BYPASS_SECRET=… node scripts/preview-proxy.mjs <port> <origin>
//
// The proxy adds the bypass header only to the requests it forwards to
// <origin>. Lighthouse's `extraHeaders` and Playwright's `extraHTTPHeaders`
// would send it to every origin a page loads from, Google Fonts included.
//
// It also makes the preview answer as production does: it asks Vercel to
// leave out its toolbar, which is not part of the app, and drops the
// `x-robots-tag: noindex` that Vercel adds to every preview, which would fail
// Lighthouse's SEO audit. It points a redirect to <origin> back at itself.

import { createServer } from "node:http";
import { request } from "node:https";

const [port, target] = process.argv.slice(2);
const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
if (!port || !target || !secret) {
  console.error(
    "usage: VERCEL_AUTOMATION_BYPASS_SECRET=… node preview-proxy.mjs <port> <origin>"
  );
  process.exit(2);
}
const origin = new URL(target);
const self = `http://127.0.0.1:${port}`;

createServer((incoming, outgoing) => {
  const upstream = request(
    {
      hostname: origin.hostname,
      path: incoming.url,
      method: incoming.method,
      headers: {
        ...incoming.headers,
        host: origin.host,
        "x-vercel-protection-bypass": secret,
        "x-vercel-skip-toolbar": "1"
      }
    },
    (response) => {
      const headers = { ...response.headers };
      delete headers["x-robots-tag"];
      if (headers.location?.startsWith(origin.origin)) {
        headers.location = self + headers.location.slice(origin.origin.length);
      }
      outgoing.writeHead(response.statusCode ?? 502, headers);
      response.pipe(outgoing);
    }
  );
  upstream.on("error", (error) => {
    if (!outgoing.headersSent) {
      outgoing.writeHead(502, { "content-type": "text/plain" });
    }
    outgoing.end(String(error));
  });
  incoming.pipe(upstream);
}).listen(Number(port), "127.0.0.1", () => {
  console.log(`preview-proxy: ${self} -> ${origin.origin}`);
});
