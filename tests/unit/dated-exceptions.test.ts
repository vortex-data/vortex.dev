/**
 * Dated exceptions enforce themselves.
 *
 * The supply chain rules allow two kinds of temporary exception, and each
 * carries the time at which it must go:
 *
 * - The `minimumReleaseAgeExcludes` list in `bunfig.toml` lets Bun resolve a
 *   release that is younger than 7 days. A comment line
 *   `# exception-expires: <UTC time>` gives the time at which the release is
 *   7 days old.
 * - An `--ignore=GHSA-...` flag on the `bun audit` step in a workflow
 *   accepts an advisory. The `auditExceptions` object in `package.json` gives
 *   each ignored advisory an `expires` time (when to try the fix again) and a
 *   `reason`.
 *
 * These tests read the real files. They fail if an exception has no time,
 * if a time has no exception, and when a time is more than GRACE_DAYS in the
 * past. The grace period keeps a missed time from failing every pull request
 * at that exact minute. After a failure, remove the exception. If an advisory
 * still has no fix, set a later time on purpose.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const GRACE_DAYS = 7;
const DAY = 86_400_000;

// A UTC time to the minute or the second, such as 2026-11-12T12:41Z.
const UTC_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?Z$/;
const EXPIRY_LINE = /^[ \t]*#[ \t]*exception-expires:[ \t]*(.*?)[ \t]*$/gm;
const IGNORE_FLAG = /--ignore[= ](GHSA(?:-[0-9a-z]{4}){3})/g;
// The list in bunfig.toml, on one line or several. Comments inside it are
// removed before the entries are counted.
const EXCLUDES = /^[ \t]*minimumReleaseAgeExcludes[ \t]*=[ \t]*\[([\s\S]*?)\]/m;

function parseTime(value: unknown): Date | null {
  if (typeof value !== "string" || !UTC_TIME.test(value)) return null;
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? null : time;
}

function overdue(expires: Date, now: Date): boolean {
  return now.getTime() > expires.getTime() + GRACE_DAYS * DAY;
}

/** The number of entries in bunfig.toml's minimumReleaseAgeExcludes. */
function excludeCount(toml: string): number {
  const list = toml.match(EXCLUDES)?.[1];
  if (list === undefined) return 0;
  const values = list.replace(/#.*$/gm, "");
  return [...values.matchAll(/"[^"]*"|'[^']*'/g)].length;
}

/** Problems with the release-age exceptions of a bunfig.toml. */
function releaseAgeProblems(toml: string, now: Date): string[] {
  const problems: string[] = [];
  const count = excludeCount(toml);
  const lines = [...toml.matchAll(EXPIRY_LINE)].map((match) => match[1] ?? "");
  if (count > 0 && lines.length === 0)
    problems.push(
      "minimumReleaseAgeExcludes has entries and no `# exception-expires:` line."
    );
  if (count === 0 && lines.length > 0)
    problems.push(
      "An `# exception-expires:` line remains and minimumReleaseAgeExcludes has no entries. Remove the line."
    );
  for (const line of lines) {
    const expires = parseTime(line);
    if (!expires)
      problems.push(
        `"${line}" is not a UTC time of the form 2026-11-12T12:41Z.`
      );
    else if (overdue(expires, now))
      problems.push(
        `The exception expired at ${line}. Remove its minimumReleaseAgeExcludes entries and its expiry line.`
      );
  }
  return problems;
}

type AuditExceptions = Record<string, { expires?: unknown; reason?: unknown }>;

/** Problems with the advisories that `commands` ignore, against `exceptions`. */
function auditIgnoreProblems(
  commands: string[],
  exceptions: AuditExceptions,
  now: Date
): string[] {
  const problems: string[] = [];
  const ignored = new Set(
    commands.flatMap((command) =>
      [...command.matchAll(IGNORE_FLAG)].map((match) => match[1] ?? "")
    )
  );
  for (const advisory of ignored) {
    const exception = exceptions[advisory];
    if (!exception) {
      problems.push(
        `${advisory} is ignored and has no entry in auditExceptions.`
      );
      continue;
    }
    const expires = parseTime(exception.expires);
    if (!expires)
      problems.push(
        `${advisory}: "expires" is not a UTC time of the form 2026-11-12T12:41Z.`
      );
    else if (overdue(expires, now))
      problems.push(
        `${advisory}: the exception expired at ${exception.expires}. Refresh the lockfile and remove the --ignore flag and this entry. If no fix exists yet, set a later time.`
      );
    if (typeof exception.reason !== "string" || exception.reason.length === 0)
      problems.push(`${advisory}: "reason" is missing.`);
  }
  for (const advisory of Object.keys(exceptions))
    if (!ignored.has(advisory))
      problems.push(
        `${advisory} has an auditExceptions entry and no --ignore flag. Remove the entry.`
      );
  return problems;
}

// The lines of the workflows that run `bun audit`. There is one workspace,
// so every such line audits the root package.
function workflowAuditCommands(): string[] {
  const directory = ".github/workflows";
  return readdirSync(directory)
    .filter((name) => /\.ya?ml$/.test(name))
    .flatMap((name) => readFileSync(join(directory, name), "utf8").split("\n"))
    .filter((line) => /\bbun audit\b/.test(line));
}

const now = new Date();
const at = (value: string) => new Date(value);

describe("dated exceptions", () => {
  it("bunfig.toml has no release-age exception without a time or past its time", () => {
    assert.deepEqual(
      releaseAgeProblems(readFileSync("bunfig.toml", "utf8"), now),
      []
    );
  });

  it("CI ignores no advisory without a time or past its time", () => {
    const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
      auditExceptions?: AuditExceptions;
    };
    const commands = workflowAuditCommands();
    assert.ok(
      commands.some((line) => /^\s*run: bun audit\b/.test(line)),
      "A workflow step runs `bun audit`."
    );
    assert.deepEqual(
      auditIgnoreProblems(commands, manifest.auditExceptions ?? {}, now),
      []
    );
  });
});

describe("the dated-exception checks reject broken input", () => {
  const toml = (body: string) =>
    `[install]\nminimumReleaseAge = 604800\n${body}`;

  it("counts the release-age exclusions on one line or several", () => {
    assert.equal(excludeCount(toml("")), 0);
    assert.equal(excludeCount(toml('minimumReleaseAgeExcludes = ["next"]')), 1);
    assert.equal(
      excludeCount(
        toml(
          'minimumReleaseAgeExcludes = [\n  "next", # GHSA-x\n  "@next/env",\n]'
        )
      ),
      2
    );
  });

  it("requires a time for each release-age exclusion and none without one", () => {
    // Before the time used here, so only the problem under test reports.
    const before = at("2026-11-12T00:00Z");
    const list = 'minimumReleaseAgeExcludes = ["next"]';
    assert.equal(releaseAgeProblems(toml(list), before).length, 1);
    assert.equal(
      releaseAgeProblems(toml("# exception-expires: 2026-11-12T12:41Z"), before)
        .length,
      1
    );
    assert.equal(
      releaseAgeProblems(
        toml(`# exception-expires: 12 November\n${list}`),
        before
      ).length,
      1
    );
  });

  it("expires a release-age exclusion 7 days after its time", () => {
    const file = toml(
      '# exception-expires: 2026-11-12T12:41Z\nminimumReleaseAgeExcludes = ["next"]'
    );
    assert.deepEqual(releaseAgeProblems(file, at("2026-11-19T12:41Z")), []);
    assert.equal(releaseAgeProblems(file, at("2026-11-19T12:42Z")).length, 1);
  });

  it("requires an entry for each ignored advisory and a flag for each entry", () => {
    const command = ["        run: bun audit --ignore=GHSA-3g3m-2fjr-6pw4"];
    const entry = {
      "GHSA-3g3m-2fjr-6pw4": { expires: "2026-11-12T12:41Z", reason: "No fix." }
    };
    assert.deepEqual(
      auditIgnoreProblems(command, entry, at("2026-11-12T00:00Z")),
      []
    );
    assert.equal(auditIgnoreProblems(command, {}, now).length, 1);
    assert.equal(
      auditIgnoreProblems(["        run: bun audit"], entry, now).length,
      1
    );
  });

  it("requires a time and a reason, and expires an advisory 7 days after its time", () => {
    const command = ["        run: bun audit --ignore GHSA-3g3m-2fjr-6pw4"];
    const entry = (expires: string, reason = "No fix.") => ({
      "GHSA-3g3m-2fjr-6pw4": { expires, reason }
    });
    assert.equal(auditIgnoreProblems(command, entry("soon"), now).length, 1);
    assert.equal(
      auditIgnoreProblems(
        command,
        entry("2026-11-12T12:41Z", ""),
        at("2026-11-12T00:00Z")
      ).length,
      1
    );
    assert.deepEqual(
      auditIgnoreProblems(
        command,
        entry("2026-11-12T12:41Z"),
        at("2026-11-19T12:41Z")
      ),
      []
    );
    assert.equal(
      auditIgnoreProblems(
        command,
        entry("2026-11-12T12:41Z"),
        at("2026-11-19T12:42Z")
      ).length,
      1
    );
  });
});
