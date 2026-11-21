// Serve a protected Vercel deployment on 127.0.0.1, so Lighthouse and
// Playwright can audit a pull request's preview without holding its bypass
// secret.
//
//   printf '%s' "$SECRET" | env -u VERCEL_AUTOMATION_BYPASS_SECRET \
//     node scripts/preview-proxy.mjs <port> <origin>
//
// The proxy adds the bypass header only to the requests it forwards to
// <origin>. Lighthouse's `extraHeaders` and Playwright's `extraHTTPHeaders`
// would send it to every origin a page loads from, Google Fonts included.
//
// The audits that follow run third-party code as the same user, and a
// process can read the environment of another process of its user. So the
// secret arrives on standard input and stays in memory only. Removing the
// variable inside this process would be too late: the system keeps the
// environment that the process started with. The proxy refuses to start
// with the variable set, and the caller must start it without it.
//
// It also makes the preview answer as production does: it asks Vercel to
// leave out its toolbar, which is not part of the app, and drops the
// `x-robots-tag: noindex` that Vercel adds to every preview, which would fail
// Lighthouse's SEO audit. It points a redirect to <origin> back at itself.

import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { resolve } from "node:path";
import { text } from "node:stream/consumers";
import { fileURLToPath } from "node:url";

const SECRET_VARIABLE = "VERCEL_AUTOMATION_BYPASS_SECRET";

/**
 * The origin to forward to. Only an HTTPS deployment on vercel.app gets the
 * secret. `allowLoopback` lets the unit tests stand in for the deployment
 * with a server on 127.0.0.1; the command line never sets it.
 */
export function destination(target, { allowLoopback = false } = {}) {
  const url = new URL(target);
  const plain =
    !url.username &&
    !url.password &&
    url.pathname === "/" &&
    !url.search &&
    !url.hash;
  if (
    allowLoopback &&
    url.protocol === "http:" &&
    url.hostname === "127.0.0.1" &&
    plain
  )
    return url;
  // One label before vercel.app, as Vercel names a deployment.
  if (
    url.protocol === "https:" &&
    /^[a-z0-9-]+\.vercel\.app$/.test(url.hostname) &&
    !url.port &&
    plain
  )
    return url;
  throw new Error(`Not a Vercel deployment origin: ${target}`);
}

/** The secret from a stream, without the line break that a shell adds. */
export async function readSecret(stream) {
  return (await text(stream)).replace(/\r?\n$/, "");
}

export function previewProxy(target, secret, { allowLoopback = false } = {}) {
  // Printable ASCII without spaces: a value that is safe in a header.
  if (typeof secret !== "string" || !/^[\x21-\x7e]+$/.test(secret))
    throw new Error("A bypass secret is required");
  const origin = destination(target, { allowLoopback });
  const request = origin.protocol === "https:" ? httpsRequest : httpRequest;
  const server = createServer((incoming, outgoing) => {
    const upstream = request(
      {
        hostname: origin.hostname,
        port: origin.port || undefined,
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
        if (headers.location) {
          // Resolve against the request's URL, as a browser does, so that
          // `Location: next` from /foo/bar stays under /foo/.
          const location = new URL(
            headers.location,
            new URL(incoming.url ?? "/", origin)
          );
          if (location.origin === origin.origin) {
            const { port } = server.address();
            headers.location = `http://127.0.0.1:${port}${location.pathname}${location.search}${location.hash}`;
          }
        }
        outgoing.writeHead(response.statusCode ?? 502, headers);
        response.pipe(outgoing);
      }
    );
    upstream.on("error", () => {
      if (!outgoing.headersSent) {
        outgoing.writeHead(502, { "content-type": "text/plain" });
      }
      outgoing.end("Preview request failed");
    });
    incoming.pipe(upstream);
  });
  return server;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const [port, target] = process.argv.slice(2);
  if (!port || !target) {
    console.error(
      "usage: printf '%s' \"$SECRET\" | node scripts/preview-proxy.mjs <port> <origin>"
    );
    process.exit(2);
  }
  if (process.env[SECRET_VARIABLE] !== undefined) {
    console.error(
      `Start the proxy without ${SECRET_VARIABLE} in its environment, and write the secret to standard input.`
    );
    process.exit(1);
  }
  const secret = await readSecret(process.stdin);
  const server = previewProxy(target, secret);
  server.listen(Number(port), "127.0.0.1", () => {
    console.log(
      `preview-proxy: http://127.0.0.1:${port} -> ${new URL(target).origin}`
    );
  });
}
