/**
 * Tests for scripts/ai-review-gate.ts.
 *
 * Run with `bun test scripts/ai-review-gate.test.ts`. Always pass the path: a
 * bare `bun test` also picks up the Playwright specs under tests/.
 *
 * These use node:test and node:assert rather than bun:test so the root
 * `tsc --noEmit`, which covers every .ts file, needs no Bun type package.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  blockingCodexThreads,
  codexHelped,
  decide,
  type GateInput,
  parseClaudeVerdict,
  parseCodexState,
  type ReviewThread
} from "./ai-review-gate";

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);

const CLAUDE_FOOTER =
  "## What changes\n\nA fix.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)";

function input(overrides: Partial<GateInput> = {}): GateInput {
  return {
    author: "lwwmanning",
    draft: false,
    body: CLAUDE_FOOTER,
    headSha: HEAD,
    codexState: { commitSha: HEAD, status: "completed" },
    codexReviewedShas: [],
    threads: [],
    claudeStatus: null,
    codexRequested: false,
    ...overrides
  };
}

function codexThread(overrides: Partial<ReviewThread> = {}): ReviewThread {
  return {
    isResolved: false,
    isOutdated: false,
    author: "chatgpt-codex-connector",
    body: "**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  A bug**",
    ...overrides
  };
}

test("codexHelped reads the footer and the author", () => {
  assert.equal(codexHelped(CLAUDE_FOOTER, "lwwmanning"), false);
  assert.equal(codexHelped(null, "lwwmanning"), false);
  assert.equal(
    codexHelped(
      "Body.\n\n------\nhttps://chatgpt.com/codex/tasks/task_e_1",
      "x"
    ),
    true
  );
  assert.equal(codexHelped("Body.\n\nWritten with Codex.", "x"), true);
  assert.equal(
    codexHelped("Body.\n\nCo-written by Claude and Codex", "x"),
    true
  );
  assert.equal(codexHelped("", "chatgpt-codex-connector[bot]"), true);
  // "Codex" high in a long body is not the footer.
  const long = `Codex review settings.\n${"line\n".repeat(10)}${CLAUDE_FOOTER}`;
  assert.equal(codexHelped(long, "x"), false);
  // A word that only contains "codex" does not count.
  assert.equal(codexHelped("Body.\n\nSee codexes.", "x"), false);
});

test("parseCodexState reads the summary marker", () => {
  const body = `<!-- codex-pull-request-review-summary -->
<!-- codex-review-state:v1 {"code_review":{"commit_sha":"${HEAD}","has_any_findings":false,"has_unresolved_findings":false,"status":"completed"},"security_review":{"commit_sha":null}} -->
<details>`;
  assert.deepEqual(parseCodexState(body), {
    commitSha: HEAD,
    status: "completed"
  });
  assert.equal(parseCodexState("A plain comment."), null);
  assert.equal(
    parseCodexState("<!-- codex-review-state:v1 {not json} -->"),
    null
  );
});

test("blockingCodexThreads counts open P0, P1 and unbadged Codex threads", () => {
  const p2 = codexThread({ body: "![P2 Badge](x) A nit" });
  const p0 = codexThread({ body: "![P0 Badge](x) Data loss" });
  const unbadged = codexThread({ body: "Something is off here." });
  assert.equal(blockingCodexThreads([codexThread(), p0, unbadged]), 3);
  assert.equal(blockingCodexThreads([p2]), 0);
  assert.equal(blockingCodexThreads([codexThread({ isResolved: true })]), 0);
  assert.equal(blockingCodexThreads([codexThread({ isOutdated: true })]), 0);
  assert.equal(
    blockingCodexThreads([codexThread({ author: "lwwmanning" })]),
    0
  );
});

test("a clean Codex review of the head passes a Claude-written PR", () => {
  const decision = decide(input());
  assert.equal(decision.state, "success");
  assert.equal(decision.needsClaude, false);
  assert.equal(decision.claudeDue, false);
  assert.equal(decision.requestCodex, false);
});

test("a PR with no AI footer still needs Codex", () => {
  const decision = decide(input({ body: "Hand-written.", codexState: null }));
  assert.equal(decision.state, "pending");
  assert.equal(decision.requestCodex, true);
  assert.equal(decision.needsClaude, false);
});

test("a Codex review of an older commit does not count", () => {
  const decision = decide(
    input({
      codexState: { commitSha: OLD, status: "completed" },
      codexReviewedShas: [OLD]
    })
  );
  assert.equal(decision.state, "pending");
  assert.equal(decision.requestCodex, true);
});

test("a submitted Codex review of the head counts without the summary", () => {
  const decision = decide(
    input({ codexState: null, codexReviewedShas: [HEAD] })
  );
  assert.equal(decision.state, "success");
});

test("the gate asks Codex once per head commit, and not while it runs", () => {
  assert.equal(
    decide(input({ codexState: null, codexRequested: true })).requestCodex,
    false
  );
  const running = decide(
    input({ codexState: { commitSha: HEAD, status: "in_progress" } })
  );
  assert.equal(running.state, "pending");
  assert.equal(running.requestCodex, false);
});

test("an open P1 Codex finding fails the gate", () => {
  const decision = decide(input({ threads: [codexThread()] }));
  assert.equal(decision.state, "failure");
  assert.match(decision.description, /Codex: 1 unresolved P0\/P1 finding\./);
});

test("a Codex-written PR waits for Claude, then follows its status", () => {
  const body = "A change.\n\n------\nhttps://chatgpt.com/codex/tasks/task_e_1";
  const waiting = decide(input({ body }));
  assert.equal(waiting.state, "pending");
  assert.equal(waiting.needsClaude, true);
  assert.equal(waiting.claudeDue, true);
  assert.match(waiting.description, /Claude/);

  const running = decide(
    input({ body, claudeStatus: { state: "pending", description: "" } })
  );
  assert.equal(running.state, "pending");
  assert.equal(running.claudeDue, false);

  const failed = decide(
    input({
      body,
      claudeStatus: { state: "failure", description: "2 P0/P1 findings" }
    })
  );
  assert.equal(failed.state, "failure");
  assert.match(failed.description, /Claude: 2 P0\/P1 findings/);

  const passed = decide(
    input({ body, claudeStatus: { state: "success", description: "" } })
  );
  assert.equal(passed.state, "success");
  assert.match(passed.description, /Codex and Claude/);
});

test("a PR from both agents needs both reviews", () => {
  const body = `A change.\n\n${CLAUDE_FOOTER}\nAlso written with Codex.`;
  const decision = decide(input({ body, codexState: null }));
  assert.equal(decision.state, "pending");
  assert.match(decision.description, /Codex and Claude/);
});

test("drafts wait and dependency updates pass", () => {
  const draft = decide(input({ draft: true, codexState: null }));
  assert.equal(draft.state, "pending");
  assert.equal(draft.requestCodex, false);
  assert.equal(draft.claudeDue, false);

  const renovate = decide(input({ author: "renovate[bot]", codexState: null }));
  assert.equal(renovate.state, "success");
});

test("parseClaudeVerdict fails closed", () => {
  assert.deepEqual(
    parseClaudeVerdict(JSON.stringify({ blocking: 0, summary: "ok" })),
    {
      ok: true,
      blocking: 0,
      summary: "ok"
    }
  );
  assert.equal(parseClaudeVerdict(undefined).ok, false);
  assert.equal(parseClaudeVerdict("").ok, false);
  assert.equal(parseClaudeVerdict("nope").ok, false);
  assert.equal(parseClaudeVerdict("null").ok, false);
  assert.equal(parseClaudeVerdict(JSON.stringify({ blocking: "0" })).ok, false);
  assert.equal(parseClaudeVerdict(JSON.stringify({ blocking: -1 })).ok, false);
  assert.equal(parseClaudeVerdict(JSON.stringify({ blocking: 1.5 })).ok, false);
});
