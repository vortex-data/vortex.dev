#!/usr/bin/env bun
/**
 * Submits bun.lock to GitHub's dependency graph.
 *
 * GitHub's dependency graph does not read bun.lock, so without this the
 * `dependency-review` check sees no transitive package at all. This script
 * turns the lock into a snapshot for the Dependency Submission API, one
 * manifest per workspace, and POSTs it. The `Dependency snapshot` workflow
 * runs it on every push to main and every same-repository pull request.
 *
 * Environment (set by GitHub Actions, or by hand):
 *   GITHUB_TOKEN       token with `contents: write`
 *   GITHUB_REPOSITORY  owner/name
 *   SNAPSHOT_SHA       commit the lock belongs to
 *   SNAPSHOT_REF       full ref of that commit, such as refs/heads/main
 *   GITHUB_WORKFLOW, GITHUB_JOB, GITHUB_RUN_ID  identify the run
 *   DRY_RUN=1          print the snapshot and submit nothing; every variable
 *                      above becomes optional
 *
 * Usage:
 *   DRY_RUN=1 bun scripts/dependency-snapshot.ts
 *
 * Exits 1 on anything but a 201 from GitHub.
 */

import { readFile } from "node:fs/promises";

type DepMap = Record<string, string>;

type PackageInfo = {
  dependencies?: DepMap;
  optionalDependencies?: DepMap;
  peerDependencies?: DepMap;
  /** Names in peerDependencies that the package marks optional. */
  optionalPeers?: string[];
};

/** `[ident, registry, info, integrity]`; the last three can be absent. */
type LockPackage = [
  ident: string,
  registry?: string,
  info?: PackageInfo,
  integrity?: string
];

type LockWorkspace = {
  name?: string;
  dependencies?: DepMap;
  devDependencies?: DepMap;
  optionalDependencies?: DepMap;
  peerDependencies?: DepMap;
};

export type BunLock = {
  workspaces: Record<string, LockWorkspace>;
  packages: Record<string, LockPackage>;
};

export type SnapshotMeta = {
  sha: string;
  ref: string;
  correlator: string;
  jobId: string;
  scanned: string;
};

type Resolved = {
  package_url: string;
  relationship: "direct" | "indirect";
  scope: "runtime" | "development";
  dependencies: string[];
};

type Manifest = {
  name: string;
  file: { source_location: string };
  resolved: Record<string, Resolved>;
};

export type Snapshot = {
  version: 0;
  sha: string;
  ref: string;
  job: { correlator: string; id: string };
  detector: { name: string; version: string; url: string };
  scanned: string;
  manifests: Record<string, Manifest>;
};

const LOCKFILE = "bun.lock";

const DETECTOR = {
  name: "vortex-dev-bun-lock",
  version: "1",
  url: "https://github.com/vortex-data/vortex.dev/blob/main/scripts/dependency-snapshot.ts"
};

/**
 * Bun writes JSONC: a trailing comma after the last entry of every object and
 * array. Drops those commas, leaving commas inside strings alone.
 */
function stripTrailingCommas(text: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += text.charAt(++i);
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === ",") {
      let next = i + 1;
      while (/\s/.test(text.charAt(next))) {
        next++;
      }
      const after = text.charAt(next);
      if (after === "}" || after === "]") {
        continue;
      }
    }
    out += ch;
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseBunLock(text: string): BunLock {
  const lock: unknown = JSON.parse(stripTrailingCommas(text));
  if (
    !isRecord(lock) ||
    !isRecord(lock.workspaces) ||
    !isRecord(lock.packages)
  ) {
    // Better to fail than to submit an empty snapshot that reads as "no
    // dependencies" if Bun changes the format.
    throw new Error(`${LOCKFILE} has no workspaces and packages tables`);
  }
  return lock as BunLock;
}

/**
 * A package key is a chain of package names joined by "/", where a scoped
 * name takes two segments: "a/@s/b" is ["a", "@s/b"].
 */
function splitKey(key: string): string[] {
  const parts = key.split("/");
  const names: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] ?? "";
    if (part.startsWith("@") && i + 1 < parts.length) {
      names.push(`${part}/${parts[++i] ?? ""}`);
    } else {
      names.push(part);
    }
  }
  return names;
}

/**
 * The key of the package that `name` resolves to for a dependent at `chain`:
 * the dependent's own nested copy, then the copy under each shorter ancestor,
 * then the top-level one. Undefined when the lock has none, as for a
 * platform-specific optional package that Bun did not install.
 */
function resolveKey(
  packages: BunLock["packages"],
  chain: string[],
  name: string
): string | undefined {
  for (let depth = chain.length; depth >= 0; depth--) {
    const candidate = [...chain.slice(0, depth), name].join("/");
    if (Object.hasOwn(packages, candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Names a package pulls in. Optional peers are left out: Bun does not install
 * them for the package, so one that is in the lock is there for another
 * reason, and keeps that reason's scope. Next.js lists Playwright this way.
 */
function childNames(info: PackageInfo | undefined): string[] {
  const optionalPeers = new Set(info?.optionalPeers);
  return [
    ...Object.keys(info?.dependencies ?? {}),
    ...Object.keys(info?.optionalDependencies ?? {}),
    ...Object.keys(info?.peerDependencies ?? {}).filter(
      (name) => !optionalPeers.has(name)
    )
  ];
}

/** Every package key reachable from `roots`. */
function reach(packages: BunLock["packages"], roots: string[]): Set<string> {
  const seen = new Set<string>();
  const pending = [...roots];
  for (let key = pending.pop(); key !== undefined; key = pending.pop()) {
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const chain = splitKey(key);
    for (const name of childNames(packages[key]?.[2])) {
      const child = resolveKey(packages, chain, name);
      if (child !== undefined) {
        pending.push(child);
      }
    }
  }
  return seen;
}

/**
 * The package URL for a lock entry, or undefined when it is not a registry
 * package (workspace:, github:, file:, link:, a tarball URL), which GitHub's
 * npm advisories cannot match.
 */
function packageUrl(entry: LockPackage | undefined): string | undefined {
  const ident = entry?.[0];
  const at = ident?.indexOf("@", 1) ?? -1;
  if (ident === undefined || at < 0) {
    return undefined;
  }
  const version = ident.slice(at + 1);
  if (version.includes(":")) {
    return undefined;
  }
  const name = ident
    .slice(0, at)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `pkg:npm/${name}@${encodeURIComponent(version)}`;
}

function resolveWorkspace(
  packages: BunLock["packages"],
  workspace: LockWorkspace
): Record<string, Resolved> {
  // Bun keys a workspace's own copy of a package as "<workspace name>/<name>".
  const chain = workspace.name ? [workspace.name] : [];
  const rootKeys = (...maps: (DepMap | undefined)[]): string[] =>
    maps
      .flatMap((map) => Object.keys(map ?? {}))
      .flatMap((name) => resolveKey(packages, chain, name) ?? []);

  const runtimeRoots = rootKeys(
    workspace.dependencies,
    workspace.optionalDependencies
  );
  const developmentRoots = rootKeys(
    workspace.devDependencies,
    workspace.peerDependencies
  );
  const runtime = reach(packages, runtimeRoots);
  const reached = reach(packages, [...runtimeRoots, ...developmentRoots]);
  const direct = new Set([...runtimeRoots, ...developmentRoots]);

  // Two keys can hold the same version, so fold them into one entry per URL.
  const byUrl = new Map<
    string,
    { direct: boolean; runtime: boolean; children: Set<string> }
  >();
  for (const key of reached) {
    const url = packageUrl(packages[key]);
    if (url === undefined) {
      continue;
    }
    const entry = byUrl.get(url) ?? {
      direct: false,
      runtime: false,
      children: new Set<string>()
    };
    entry.direct ||= direct.has(key);
    entry.runtime ||= runtime.has(key);
    const keyChain = splitKey(key);
    for (const name of childNames(packages[key]?.[2])) {
      const child = resolveKey(packages, keyChain, name);
      const childUrl =
        child === undefined ? undefined : packageUrl(packages[child]);
      if (childUrl !== undefined && childUrl !== url) {
        entry.children.add(childUrl);
      }
    }
    byUrl.set(url, entry);
  }

  const resolved: Record<string, Resolved> = {};
  for (const url of [...byUrl.keys()].sort()) {
    const entry = byUrl.get(url);
    if (entry === undefined) {
      continue;
    }
    resolved[url] = {
      package_url: url,
      relationship: entry.direct ? "direct" : "indirect",
      scope: entry.runtime ? "runtime" : "development",
      dependencies: [...entry.children].sort()
    };
  }
  return resolved;
}

export function buildSnapshot(lock: BunLock, meta: SnapshotMeta): Snapshot {
  const manifests: Record<string, Manifest> = {};
  for (const [path, workspace] of Object.entries(lock.workspaces)) {
    // The root workspace has an empty path, so it goes by its name.
    const name = `${LOCKFILE} (${path || workspace.name || "root"})`;
    manifests[name] = {
      name,
      file: { source_location: LOCKFILE },
      resolved: resolveWorkspace(lock.packages, workspace)
    };
  }
  return {
    version: 0,
    sha: meta.sha,
    ref: meta.ref,
    job: { correlator: meta.correlator, id: meta.jobId },
    detector: DETECTOR,
    scanned: meta.scanned,
    manifests
  };
}

async function main(): Promise<void> {
  const dryRun = process.env.DRY_RUN === "1";
  const env = (name: string, dryRunValue: string): string => {
    const value = process.env[name];
    if (value) {
      return value;
    }
    if (dryRun) {
      return dryRunValue;
    }
    throw new Error(`${name} is not set`);
  };

  const lock = parseBunLock(
    await readFile(new URL(`../${LOCKFILE}`, import.meta.url), "utf8")
  );
  const snapshot = buildSnapshot(lock, {
    sha: env("SNAPSHOT_SHA", "0".repeat(40)),
    ref: env("SNAPSHOT_REF", "refs/heads/dry-run"),
    // Stable across runs of the same workflow and job, so each snapshot
    // replaces the last one for its ref instead of piling up.
    correlator: `${env("GITHUB_WORKFLOW", "local")}-${env("GITHUB_JOB", "local")}`,
    jobId: env("GITHUB_RUN_ID", "0"),
    scanned: new Date().toISOString()
  });

  for (const manifest of Object.values(snapshot.manifests)) {
    const all = Object.values(manifest.resolved);
    const runtime = all.filter((pkg) => pkg.scope === "runtime").length;
    console.error(
      `${manifest.name}: ${all.length} packages, ${runtime} runtime, ${all.length - runtime} development`
    );
  }

  if (dryRun) {
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }

  const api = process.env.GITHUB_API_URL ?? "https://api.github.com";
  const response = await fetch(
    `${api}/repos/${env("GITHUB_REPOSITORY", "")}/dependency-graph/snapshots`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${env("GITHUB_TOKEN", "")}`,
        "Content-Type": "application/json",
        "User-Agent": DETECTOR.name,
        "X-GitHub-Api-Version": "2022-11-28"
      },
      body: JSON.stringify(snapshot)
    }
  );
  const body = await response.text();
  if (response.status !== 201) {
    throw new Error(`GitHub answered ${response.status}: ${body}`);
  }
  console.error(`Submitted ${snapshot.sha} on ${snapshot.ref}: ${body}`);
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
