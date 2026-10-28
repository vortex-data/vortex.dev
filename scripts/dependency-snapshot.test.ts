/**
 * Tests for scripts/dependency-snapshot.ts.
 *
 * Run with `bun test scripts/dependency-snapshot.test.ts`. Always pass the
 * path: a bare `bun test` also picks up the Playwright specs under tests/.
 *
 * These use node:test and node:assert rather than bun:test so the root
 * `tsc --noEmit`, which covers every .ts file, needs no Bun type package.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  type BunLock,
  buildSnapshot,
  parseBunLock,
  type SnapshotMeta
} from "./dependency-snapshot";

const META: SnapshotMeta = {
  sha: "a".repeat(40),
  ref: "refs/heads/main",
  correlator: "Dependency snapshot-snapshot",
  jobId: "42",
  scanned: "2026-10-28T00:00:00Z"
};

// Written the way Bun writes it: JSONC with a trailing comma after every
// entry. `a` has a nested copy of `c`, which only `a` resolves to; `d` is a
// devDependency whose `c` is the top-level one.
const FIXTURE = `{
  "lockfileVersion": 2,
  "workspaces": {
    "": {
      "name": "vortex",
      "dependencies": {
        "a": "^1.0.0",
      },
      "devDependencies": {
        "d": "^1.0.0",
      },
    },
    "bench/web": {
      "name": "benchmarks-web",
      "dependencies": {
        "@s/x": "^1.0.0",
      },
    },
  },
  "packages": {
    "a": ["a@1.0.0", "", { "dependencies": { "b": "^1.0.0", "c": "^2.0.0" } }, "sha512-a"],

    "a/c": ["c@2.0.0", "", {}, "sha512-c2"],

    "b": ["b@1.0.0", "", {}, "sha512-b"],

    "c": ["c@1.0.0", "", {}, "sha512-c1"],

    "d": ["d@1.0.0", "", { "dependencies": { "b": "^1.0.0", "c": "^1.0.0" } }, "sha512-d"],

    "@s/x": ["@s/x@1.0.0", "", {}, "sha512-x"],
  }
}`;

// A lock built from parts, for the cases the main fixture does not cover.
function lockOf(
  workspaces: BunLock["workspaces"],
  packages: BunLock["packages"]
): BunLock {
  return { workspaces, packages };
}

test("parseBunLock reads Bun's JSONC and leaves string contents alone", () => {
  const lock = parseBunLock(`{
    "workspaces": { "": { "name": "w", "dependencies": { "a": "x,}", }, }, },
    "packages": { "a": ["a@1.0.0", "", {},], },
  }`);
  assert.equal(lock.workspaces[""]?.dependencies?.a, "x,}");
  assert.equal(lock.packages.a?.[0], "a@1.0.0");
});

test("parseBunLock rejects a lock without workspaces and packages", () => {
  assert.throws(() => parseBunLock("{}"), /workspaces/);
});

test("buildSnapshot describes the snapshot for GitHub's submission API", () => {
  const snap = buildSnapshot(parseBunLock(FIXTURE), META);
  assert.equal(snap.version, 0);
  assert.equal(snap.sha, META.sha);
  assert.equal(snap.ref, META.ref);
  assert.deepEqual(snap.job, { correlator: META.correlator, id: "42" });
  assert.equal(snap.detector.name, "vortex-dev-bun-lock");
  assert.equal(snap.detector.version, "1");
  assert.match(snap.detector.url, /^https:\/\/github\.com\/vortex-data\//);
  assert.equal(snap.scanned, META.scanned);
  assert.deepEqual(Object.keys(snap.manifests), [
    "bun.lock (vortex)",
    "bun.lock (bench/web)"
  ]);
});

test("buildSnapshot scopes each package by what reaches it", () => {
  const snap = buildSnapshot(parseBunLock(FIXTURE), META);
  const root = snap.manifests["bun.lock (vortex)"]?.resolved ?? {};

  assert.equal(root["pkg:npm/a@1.0.0"]?.relationship, "direct");
  assert.equal(root["pkg:npm/a@1.0.0"]?.scope, "runtime");
  assert.equal(root["pkg:npm/d@1.0.0"]?.relationship, "direct");
  assert.equal(root["pkg:npm/d@1.0.0"]?.scope, "development");
  // Reachable from a, which is a runtime dependency.
  assert.equal(root["pkg:npm/b@1.0.0"]?.relationship, "indirect");
  assert.equal(root["pkg:npm/b@1.0.0"]?.scope, "runtime");
  // a resolves the nested a/c, so only d reaches the top-level c.
  assert.equal(root["pkg:npm/c@2.0.0"]?.scope, "runtime");
  assert.equal(root["pkg:npm/c@1.0.0"]?.scope, "development");
  assert.deepEqual(root["pkg:npm/a@1.0.0"]?.dependencies, [
    "pkg:npm/b@1.0.0",
    "pkg:npm/c@2.0.0"
  ]);
  assert.deepEqual(root["pkg:npm/d@1.0.0"]?.dependencies, [
    "pkg:npm/b@1.0.0",
    "pkg:npm/c@1.0.0"
  ]);
  // Only what the workspace reaches: bench/web's @s/x is not in this one.
  assert.equal(Object.keys(root).length, 5);
});

test("buildSnapshot makes one manifest per workspace and encodes scoped names", () => {
  const snap = buildSnapshot(parseBunLock(FIXTURE), META);
  const bench = snap.manifests["bun.lock (bench/web)"];

  assert.equal(bench?.file.source_location, "bun.lock");
  assert.deepEqual(Object.keys(bench?.resolved ?? {}), [
    "pkg:npm/%40s/x@1.0.0"
  ]);
  const x = bench?.resolved["pkg:npm/%40s/x@1.0.0"];
  assert.equal(x?.package_url, "pkg:npm/%40s/x@1.0.0");
  assert.equal(x?.relationship, "direct");
  assert.equal(x?.scope, "runtime");
});

test("a workspace's own copy is keyed by its name, not its path", () => {
  const snap = buildSnapshot(
    lockOf(
      {
        "": { name: "vortex", dependencies: { zod: "^3.0.0" } },
        "bench/web": { name: "benchmarks-web", dependencies: { zod: "^4.0.0" } }
      },
      {
        zod: ["zod@3.0.0", "", {}, "h"],
        "benchmarks-web/zod": ["zod@4.0.0", "", {}, "h"],
        // What a lookup by path would find, if the code used the path.
        "bench/web/zod": ["zod@9.0.0", "", {}, "h"]
      }
    ),
    META
  );
  assert.deepEqual(Object.keys(snap.manifests), [
    "bun.lock (vortex)",
    "bun.lock (bench/web)"
  ]);
  assert.deepEqual(
    Object.keys(snap.manifests["bun.lock (vortex)"]?.resolved ?? {}),
    ["pkg:npm/zod@3.0.0"]
  );
  assert.deepEqual(
    Object.keys(snap.manifests["bun.lock (bench/web)"]?.resolved ?? {}),
    ["pkg:npm/zod@4.0.0"]
  );
});

test("a dependency resolves through each shorter ancestor, scoped names included", () => {
  const snap = buildSnapshot(
    lockOf(
      { "": { name: "w", dependencies: { "@s/x": "^1.0.0" } } },
      {
        "@s/x": ["@s/x@1.0.0", "", { dependencies: { "@t/y": "^1.0.0" } }, "h"],
        // Nested two deep, under a scoped package.
        "@s/x/@t/y": [
          "@t/y@1.0.0",
          "",
          { dependencies: { m: "^1.0.0", n: "^1.0.0", o: "^1.0.0" } },
          "h"
        ],
        "@s/x/@t/y/m": ["m@3.0.0", "", {}, "h"],
        "@s/x/n": ["n@2.0.0", "", {}, "h"],
        n: ["n@1.0.0", "", {}, "h"],
        o: ["o@1.0.0", "", {}, "h"]
      }
    ),
    META
  );
  const resolved = snap.manifests["bun.lock (w)"]?.resolved ?? {};
  assert.deepEqual(resolved["pkg:npm/%40t/y@1.0.0"]?.dependencies, [
    "pkg:npm/m@3.0.0",
    "pkg:npm/n@2.0.0",
    "pkg:npm/o@1.0.0"
  ]);
  assert.equal(resolved["pkg:npm/n@1.0.0"], undefined);
});

test("an optional peer does not make a development package runtime", () => {
  const snap = buildSnapshot(
    lockOf(
      {
        "": {
          name: "w",
          dependencies: { app: "^1.0.0" },
          devDependencies: { tool: "^1.0.0" }
        }
      },
      {
        app: [
          "app@1.0.0",
          "",
          {
            // Next.js asks for Playwright this way; it is not installed for
            // app, and must not pull tool, or what tool needs, into runtime.
            peerDependencies: { tool: "^1.0.0", react: "^19.0.0" },
            optionalPeers: ["tool"]
          },
          "h"
        ],
        react: ["react@19.0.0", "", {}, "h"],
        tool: ["tool@1.0.0", "", { dependencies: { helper: "^1.0.0" } }, "h"],
        helper: ["helper@1.0.0", "", {}, "h"]
      }
    ),
    META
  );
  const resolved = snap.manifests["bun.lock (w)"]?.resolved ?? {};
  assert.equal(resolved["pkg:npm/tool@1.0.0"]?.scope, "development");
  assert.equal(resolved["pkg:npm/helper@1.0.0"]?.scope, "development");
  // A required peer is installed for app, so it is a runtime package.
  assert.equal(resolved["pkg:npm/react@19.0.0"]?.scope, "runtime");
  assert.deepEqual(resolved["pkg:npm/app@1.0.0"]?.dependencies, [
    "pkg:npm/react@19.0.0"
  ]);
});

test("buildSnapshot skips names the lock lacks and packages with no npm purl", () => {
  const snap = buildSnapshot(
    lockOf(
      {
        "": {
          name: "w",
          dependencies: { a: "^1.0.0", local: "workspace:*" }
        }
      },
      {
        a: [
          "a@1.0.0",
          "",
          {
            // A platform build that bun did not install on this platform.
            optionalDependencies: { "a-win32": "1.0.0" },
            dependencies: { local: "workspace:*" }
          },
          "h"
        ],
        local: ["local@workspace:packages/local"]
      }
    ),
    META
  );
  const resolved = snap.manifests["bun.lock (w)"]?.resolved ?? {};
  assert.deepEqual(Object.keys(resolved), ["pkg:npm/a@1.0.0"]);
  assert.deepEqual(resolved["pkg:npm/a@1.0.0"]?.dependencies, []);
});

// The CLI, run as a subprocess against a local stand-in for the GitHub API.

const SCRIPT = fileURLToPath(
  new URL("./dependency-snapshot.ts", import.meta.url)
);
const TOKEN = "token-for-the-local-mock";
const SUBMIT_ENV = {
  GITHUB_REPOSITORY: "vortex-data/vortex.dev",
  GITHUB_TOKEN: TOKEN,
  SNAPSHOT_SHA: "c".repeat(40),
  SNAPSHOT_REF: "refs/heads/main",
  GITHUB_WORKFLOW: "Dependency snapshot",
  GITHUB_JOB: "snapshot",
  GITHUB_RUN_ID: "1",
  SNAPSHOT_RETRY_DELAY_MS: "10"
};

type Request = { url: string; authorization: string };

/**
 * Answers the nth request with statuses[n], and the last status once they
 * run out. Passes the API URL and the requests seen so far to `run`.
 */
async function withApi(
  statuses: number[],
  run: (apiUrl: string, requests: Request[]) => Promise<void>
): Promise<void> {
  const requests: Request[] = [];
  const server = createServer((req, res) => {
    requests.push({
      url: req.url ?? "",
      authorization: req.headers.authorization ?? ""
    });
    const status =
      statuses[Math.min(requests.length, statuses.length) - 1] ?? 500;
    req.resume();
    req.on("end", () => {
      res.writeHead(status, { connection: "close" });
      res.end(JSON.stringify(status === 201 ? { id: 1 } : { message: "mock" }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${port}`, requests);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

/** Runs the script with only the given environment, and returns how it ended. */
function runCli(
  apiUrl: string
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT], {
      env: {
        NODE_ENV: "test",
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        ...SUBMIT_ENV,
        GITHUB_API_URL: apiUrl
      }
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
  });
}

test("the CLI submits once to the repository's snapshot endpoint", async () => {
  await withApi([201], async (apiUrl, requests) => {
    const { code, output } = await runCli(apiUrl);
    assert.equal(code, 0, output);
    assert.deepEqual(requests, [
      {
        url: "/repos/vortex-data/vortex.dev/dependency-graph/snapshots",
        authorization: `Bearer ${TOKEN}`
      }
    ]);
    assert.doesNotMatch(output, /Retrying/);
  });
});

test("the CLI retries a 503 once, and succeeds if the retry does", async () => {
  await withApi([503, 201], async (apiUrl, requests) => {
    const { code, output } = await runCli(apiUrl);
    assert.equal(code, 0, output);
    assert.equal(requests.length, 2);
    assert.ok(requests.every((r) => r.authorization === `Bearer ${TOKEN}`));
    assert.match(output, /GitHub answered 503/);
    assert.match(output, /Retrying once/);
    assert.ok(!output.includes(TOKEN), "the token must not be logged");
  });
});

test("the CLI exits 1 when the retry fails too", async () => {
  await withApi([503], async (apiUrl, requests) => {
    const { code, output } = await runCli(apiUrl);
    assert.equal(code, 1, output);
    assert.equal(requests.length, 2);
    assert.ok(!output.includes(TOKEN), "the token must not be logged");
  });
});

test("the CLI does not retry a 422", async () => {
  await withApi([422], async (apiUrl, requests) => {
    const { code, output } = await runCli(apiUrl);
    assert.equal(code, 1, output);
    assert.equal(requests.length, 1);
    assert.match(output, /GitHub answered 422/);
    assert.doesNotMatch(output, /Retrying/);
    assert.ok(!output.includes(TOKEN), "the token must not be logged");
  });
});

test("the CLI retries a network error once, then exits 1", async () => {
  // A port that nothing listens on: bind one, then close it.
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));

  const { code, output } = await runCli(`http://127.0.0.1:${port}`);
  assert.equal(code, 1, output);
  assert.match(output, /Request failed/);
  assert.match(output, /Retrying once/);
  assert.ok(!output.includes(TOKEN), "the token must not be logged");
});
