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
import { test } from "node:test";
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

test("a workspace's own copy of a package wins over the hoisted one", () => {
  const snap = buildSnapshot(
    lockOf(
      {
        "": { name: "root", dependencies: { b: "^1.0.0" } },
        app: { name: "app", dependencies: { b: "^2.0.0" } }
      },
      {
        b: ["b@1.0.0", "", {}, "sha512-b1"],
        "app/b": ["b@2.0.0", "", {}, "sha512-b2"]
      }
    ),
    META
  );
  assert.deepEqual(
    Object.keys(snap.manifests["bun.lock (root)"]?.resolved ?? {}),
    ["pkg:npm/b@1.0.0"]
  );
  assert.deepEqual(
    Object.keys(snap.manifests["bun.lock (app)"]?.resolved ?? {}),
    ["pkg:npm/b@2.0.0"]
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
