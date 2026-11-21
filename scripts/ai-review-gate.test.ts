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
  approversOf,
  blockingCodexThreads,
  claudeContext,
  codexHelped,
  decide,
  type GateInput,
  parseClaudeVerdict,
  parseCodexState,
  type ReviewThread,
  shouldRequestCodex
} from "./ai-review-gate";

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);
const NOW = Date.parse("2026-11-21T12:00:00Z");
const MINUTE = 60 * 1000;

const CLAUDE_FOOTER =
  "## What changes\n\nA fix.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)";

function input(overrides: Partial<GateInput> = {}): GateInput {
  return {
    author: "lwwmanning",
    draft: false,
    body: CLAUDE_FOOTER,
    headSha: HEAD,
    codexState: { commitSha: HEAD, status: "completed", hasFindings: false },
    codexStateUpdatedAt: NOW - MINUTE,
    codexReviewedShas: [],
    threads: [],
    claudeStatus: null,
    authorTrusted: true,
    maintainerApprovedShas: [],
    codexRequests: [],
    now: NOW,
    siblingPrs: [],
    baseChanged: false,
    ...overrides
  };
}

function codexThread(overrides: Partial<ReviewThread> = {}): ReviewThread {
  return {
    isResolved: false,
    isOutdated: false,
    author: "chatgpt-codex-connector",
    body: "**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  A bug**",
    commitSha: HEAD,
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
    status: "completed",
    hasFindings: false
  });
  assert.equal(
    parseCodexState(
      body.replace('"has_any_findings":false', '"has_any_findings":true')
    )?.hasFindings,
    true
  );
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
      codexState: { commitSha: OLD, status: "completed", hasFindings: false },
      codexReviewedShas: [OLD]
    })
  );
  assert.equal(decision.state, "pending");
  assert.equal(decision.requestCodex, true);
});

test("a submitted Codex review wins over a summary still marked running", () => {
  const decision = decide(
    input({
      codexState: {
        commitSha: HEAD,
        status: "in_progress",
        hasFindings: false
      },
      codexReviewedShas: [HEAD]
    })
  );
  assert.equal(decision.state, "success");
});

test("another open PR with the same head commit blocks the gate", () => {
  const decision = decide(input({ siblingPrs: [12] }));
  assert.equal(decision.state, "failure");
  assert.match(decision.description, /#12/);
  // Even a dependency update, whose status would otherwise pass.
  assert.equal(
    decide(input({ author: "renovate[bot]", siblingPrs: [12] })).state,
    "failure"
  );
});

test("a submitted Codex review of the head counts without the summary", () => {
  const decision = decide(
    input({ codexState: null, codexReviewedShas: [HEAD] })
  );
  assert.equal(decision.state, "success");
});

test("the gate asks Codex again only after a wait, up to three times", () => {
  assert.equal(shouldRequestCodex([], NOW), true);
  assert.equal(shouldRequestCodex([NOW - 5 * MINUTE], NOW), false);
  assert.equal(shouldRequestCodex([NOW - 25 * MINUTE], NOW), true);
  const three = [NOW - 90 * MINUTE, NOW - 60 * MINUTE, NOW - 30 * MINUTE];
  assert.equal(shouldRequestCodex(three, NOW), false);
  assert.equal(
    decide(input({ codexState: null, codexRequests: [NOW - MINUTE] }))
      .requestCodex,
    false
  );
});

test("the gate does not ask Codex while its review runs", () => {
  const codexState = {
    commitSha: HEAD,
    status: "in_progress",
    hasFindings: false
  };
  const running = decide(input({ codexState }));
  assert.equal(running.state, "pending");
  assert.equal(running.requestCodex, false);

  // A review that stays in progress for over an hour has stopped.
  const stalled = decide(
    input({ codexState, codexStateUpdatedAt: NOW - 90 * MINUTE })
  );
  assert.equal(stalled.state, "pending");
  assert.equal(stalled.requestCodex, true);
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
    input({
      body,
      claudeStatus: {
        state: "pending",
        description: "",
        updatedAt: NOW - MINUTE
      }
    })
  );
  assert.equal(running.state, "pending");
  assert.equal(running.claudeDue, false);

  // Claude finished with findings: its open P0/P1 threads block.
  const reviewed = {
    state: "success",
    description: "Reviewed: 1 P0/P1 finding.",
    updatedAt: NOW
  };
  const claudeP1 = codexThread({
    author: "github-actions",
    body: "**P1** A bug."
  });
  const failed = decide(
    input({ body, claudeStatus: reviewed, threads: [claudeP1] })
  );
  assert.equal(failed.state, "failure");
  assert.match(failed.description, /Claude: 1 unresolved P0\/P1 finding\./);
  assert.equal(failed.claudeDue, false);

  // Resolving the thread clears it on the next run, with no new push.
  const cleared = decide(
    input({
      body,
      claudeStatus: reviewed,
      threads: [{ ...claudeP1, isResolved: true }]
    })
  );
  assert.equal(cleared.state, "success");

  // A P2 from Claude does not block.
  const p2 = decide(
    input({
      body,
      claudeStatus: {
        state: "success",
        description: "Reviewed: 0 P0/P1 findings.",
        updatedAt: NOW
      },
      threads: [{ ...claudeP1, body: "**P2** A nit." }]
    })
  );
  assert.equal(p2.state, "success");

  // A review that did not finish is retried, not counted as a finding.
  const errored = decide(
    input({
      body,
      claudeStatus: {
        state: "error",
        description: "no verdict",
        updatedAt: NOW
      }
    })
  );
  assert.equal(errored.state, "failure");
  assert.equal(errored.claudeDue, true);
  assert.match(errored.description, /did not finish \(no verdict\)/);

  const passed = decide(
    input({
      body,
      claudeStatus: {
        state: "success",
        description: "Reviewed: 0 P0/P1 findings.",
        updatedAt: NOW
      }
    })
  );
  assert.equal(passed.state, "success");
  assert.match(passed.description, /Codex and Claude/);
});

test("a PR from both agents needs both reviews", () => {
  const body = `A change.\n\n${CLAUDE_FOOTER}\nAlso written with Codex.`;
  const decision = decide(input({ body, codexState: null }));
  assert.equal(decision.state, "pending");
  assert.match(decision.description, /Codex's review and Claude's review/);
});

test("a review that stays pending too long is started again", () => {
  const body = "A change.\n\nWritten with Codex.";
  const stale = decide(
    input({
      body,
      claudeStatus: {
        state: "pending",
        description: "",
        updatedAt: NOW - 60 * MINUTE
      }
    })
  );
  assert.equal(stale.state, "failure");
  assert.equal(stale.claudeDue, true);
  assert.match(stale.description, /stopped without a verdict/);
});

test("an outside PR from Codex needs a maintainer's approval, not Claude", () => {
  const body = "A change.\n\nWritten with Codex.";
  const waiting = decide(input({ body, authorTrusted: false }));
  assert.equal(waiting.state, "pending");
  assert.equal(waiting.claudeDue, false);
  assert.match(waiting.description, /a maintainer's approval/);

  // An approval of an older commit does not count.
  assert.equal(
    decide(input({ body, authorTrusted: false, maintainerApprovedShas: [OLD] }))
      .state,
    "pending"
  );

  const approved = decide(
    input({ body, authorTrusted: false, maintainerApprovedShas: [HEAD] })
  );
  assert.equal(approved.state, "success");
  assert.equal(approved.claudeDue, false);
  assert.match(approved.description, /maintainer approved/);

  // An outside PR that Codex did not help write needs only Codex.
  assert.equal(decide(input({ authorTrusted: false })).state, "success");
});

test("the Claude status name holds the PR number", () => {
  assert.equal(claudeContext(229), "AI cross-review / Claude #229");
});

test("a base change voids the reviews of the head commit", () => {
  const decision = decide(input({ baseChanged: true }));
  assert.equal(decision.state, "failure");
  assert.match(decision.description, /base branch changed/);
  assert.equal(decision.requestCodex, false);
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

test("Codex findings that no thread shows block the gate", () => {
  const reported = {
    commitSha: HEAD,
    status: "completed",
    hasFindings: true
  };
  const missing = decide(input({ codexState: reported }));
  assert.equal(missing.state, "failure");
  assert.match(missing.description, /no thread shows/);

  // A resolved thread on the head commit shows the findings.
  assert.equal(
    decide(
      input({
        codexState: reported,
        threads: [codexThread({ isResolved: true })]
      })
    ).state,
    "success"
  );

  // A thread from an older commit does not.
  assert.equal(
    decide(
      input({
        codexState: reported,
        threads: [codexThread({ isResolved: true, commitSha: OLD })]
      })
    ).state,
    "failure"
  );
});

test("a later request for changes withdraws an approval", () => {
  const user = { login: "reviewer" };
  const approved = { user, commit_id: HEAD, state: "APPROVED" };
  assert.deepEqual(approversOf([approved], HEAD), ["reviewer"]);
  assert.deepEqual(
    approversOf(
      [approved, { user, commit_id: HEAD, state: "CHANGES_REQUESTED" }],
      HEAD
    ),
    []
  );
  // A comment after the approval changes nothing.
  assert.deepEqual(
    approversOf(
      [approved, { user, commit_id: HEAD, state: "COMMENTED" }],
      HEAD
    ),
    ["reviewer"]
  );
  // An approval of an older commit does not count.
  assert.deepEqual(
    approversOf([{ user, commit_id: OLD, state: "APPROVED" }], HEAD),
    []
  );
});
