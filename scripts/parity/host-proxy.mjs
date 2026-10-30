// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

// Forward every request to a server as if it were addressed to another host, so a browser or a
// script on 127.0.0.1 sees bench the way bench.vortex.dev serves it. Neither `fetch` nor a
// browser can set `Host` itself, and a browser cannot reach bench.vortex.dev over plain HTTP:
// the whole .dev domain is on the HSTS preload list.
//
//   node host-proxy.mjs <listen-port> <target-origin> <host>
//
// The proxy listens on 127.0.0.1 only. It passes responses through as they are, redirects
// included, and answers 502 when the target does not.

import { createServer, request } from 'node:http';

const [port, target, host] = process.argv.slice(2);
if (!port || !target || !host) {
  console.error('usage: node host-proxy.mjs <listen-port> <target-origin> <host>');
  process.exit(2);
}
const origin = new URL(target);

createServer((incoming, outgoing) => {
  const upstream = request(
    {
      hostname: origin.hostname,
      port: origin.port,
      path: incoming.url,
      method: incoming.method,
      headers: { ...incoming.headers, host },
    },
    (response) => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(outgoing);
    },
  );
  upstream.on('error', (error) => {
    if (!outgoing.headersSent) {
      outgoing.writeHead(502, { 'content-type': 'text/plain' });
    }
    outgoing.end(String(error));
  });
  incoming.pipe(upstream);
}).listen(Number(port), '127.0.0.1', () => {
  console.log(`host-proxy: 127.0.0.1:${port} -> ${origin.origin} as ${host}`);
});
