#!/usr/bin/env bun
/**
 * The AI cross-review gate.
 *
 * Every pull request needs a Codex review of its head commit. A pull request
 * that Codex helped write also needs a Claude review of its head commit. The
 * gate finds Codex's help in the last lines of the pull request body (the
 * footer) or in the author's login. The gate writes its result as the commit
 * status `AI cross-review` on the head commit, and the `main` ruleset requires
 * that status, so auto-merge waits for it.
 *
 * The status is:
 *   success  each required review covers the head commit and has no blocking
 *            finding
 *   pending  a required review or approval of the head commit is not there
 *            yet, or the pull request is a draft
 *   failure  a required review has a blocking finding, the Claude review did
 *            not finish, the base branch changed, or another open pull
 *            request has the same head commit
 *
 * A blocking finding is a P0 or P1 finding. For Codex, it is an unresolved
 * review thread that Codex started, on a line the head commit still has (not
 * outdated), with a P0 or P1 badge or with no badge. For Claude, it is an
 * unresolved, not outdated thread from the review that starts with "**P0**"
 * or "**P1**". At verdict time, `claude-verdict` checks that each P0 or P1
 * finding Claude counted has an open thread; if not, it records the review
 * as unfinished, because nobody could resolve those findings.
 *
 * Claude reviews only for an author with write access, or Codex, so an
 * outside author cannot spend the API key. An outside pull request that Codex
 * helped write needs a maintainer's approval of the head commit instead.
 *
 * Retries: when Codex has not reviewed the head commit, the gate posts
 * `@codex review`, and posts it again on a later run if Codex has still not
 * started after RETRY_CODEX_AFTER_MS, up to MAX_CODEX_REQUESTS times per
 * commit. A Claude review that ended without a verdict sets the Claude status
 * to `error`, not `failure`, and the next gate run starts a new one. So does
 * a Claude status still pending after STALE_CLAUDE_MS.
 *
 * ai-review.yml runs this script from main on base-branch events
 * (pull_request_target, issue_comment), so a pull
 * request cannot change the rules that judge it.
 *
 * Commands:
 *   gate                   evaluate the pull request, set the status, ask
 *                          Codex for a review of the head commit if it has
 *                          none, and write `head_sha` and `claude_due` to
 *                          GITHUB_OUTPUT
 *   claude-verdict         read the Claude review's verdict from
 *                          CLAUDE_VERDICT and set the
 *                          `AI cross-review / Claude #<PR_NUMBER>` status on
 *                          HEAD_SHA
 *
 * Environment (set by GitHub Actions, or by hand):
 *   GITHUB_TOKEN       token with `statuses: write` and `pull-requests: write`
 *   GITHUB_REPOSITORY  owner/name
 *   PR_NUMBER          the pull request
 *   HEAD_SHA           the head commit, for `claude-verdict`
 *   CLAUDE_VERDICT     the Claude review's structured output, a JSON object
 *                      `{ "blocking": number, "summary": string }`; empty
 *                      when the review did not finish
 *   GITHUB_SERVER_URL, GITHUB_RUN_ID  link each status to its run
 *   GITHUB_OUTPUT      where `gate` writes its outputs
 *   TRIGGER_ACTOR      the actor of the event; `gate` starts a Claude review
 *                      only for Codex, this workflow, or a writer
 *   REFRESH=1          a scheduled recheck: write the status only if the
 *                      result changed
 *   DRY_RUN=1          print what the gate would do and write nothing
 */

import { createHash } from "node:crypto";
import { appendFile } from "node:fs/promises";

const GATE_CONTEXT = "AI cross-review";
/**
 * The Claude review's status. Its name holds the pull request's number,
 * because a commit status belongs to a commit, and another pull request with
 * the same head commit must not reuse this pull request's review.
 */
export function claudeContext(pr: number): string {
  return `AI cross-review / Claude #${pr}`;
}

/** The login of the Claude review's inline comments: the workflow token's. */
const CLAUDE_THREAD_AUTHOR = "github-actions";
const CODEX_LOGIN = "chatgpt-codex-connector[bot]";

/** Authors whose pull requests need no AI review: dependency updates. */
const EXEMPT_AUTHORS = new Set(["renovate[bot]", "dependabot[bot]"]);

/** How many non-empty lines at the end of the body count as the footer. */
const FOOTER_LINES = 5;

/** The hidden marker on the gate's own `@codex review` comments. */
const REQUEST_MARKER = "<!-- ai-review-gate:codex-requested";

/**
 * The status that records the base branch a pull request had when the gate
 * first saw its head commit. The diff can change with the base, so when the
 * base differs from the record, no review of that commit counts any more.
 * The gate compares state, not events: GitHub can cancel a waiting run, so
 * the run for the event that changed the base may never run. A status, not a
 * comment, because only a token with write access can set one.
 */
function baseContext(pr: number): string {
  return `AI cross-review / base #${pr}`;
}

/**
 * A branch name can be longer than a status description, so the record
 * starts with the name's SHA-256, which the clip cannot cut.
 */
function baseRecord(ref: string): string {
  const hash = createHash("sha256").update(ref).digest("hex");
  return clip(`Base ${hash}: ${ref}`);
}

type Review = {
  user: { login: string } | null;
  commit_id: string;
  state: string;
};

/**
 * The reviewers whose latest approving or blocking review approves
 * `headSha`. A later request for changes withdraws an approval, as it does
 * on GitHub, and a comment-only review changes nothing.
 */
export function approversOf(reviews: Review[], headSha: string): string[] {
  const latest = new Map<string, Review>();
  for (const review of reviews) {
    if (!review.user) continue;
    if (["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state)) {
      latest.set(review.user.login, review);
    }
  }
  return [...latest]
    .filter(([, r]) => r.state === "APPROVED" && r.commit_id === headSha)
    .map(([login]) => login);
}

/**
 * Authors whose pull requests Claude may review. The review runs with the
 * Anthropic key and a write token, so it never reads an outside author's
 * pull request: a maintainer's approval of the head commit replaces it.
 */
// Repository permissions that can push. `author_association` is not enough:
// an organization member with read access is still a MEMBER.
const WRITE_PERMISSIONS = new Set(["admin", "write"]);

/** How long a Claude review can stay pending before the gate retries it. */
const STALE_CLAUDE_MS = 45 * 60 * 1000;

/**
 * How many Claude reviews the gate starts for one head commit. Retries come
 * on their own from the scheduled refresh, so the cap bounds the API spend.
 */
const MAX_CLAUDE_ATTEMPTS = 3;

/** The author of the gate's own comments: the workflow token's. */
const GATE_LOGIN = "github-actions[bot]";

/** Bots that the Claude job's `allowed_bots` lets start a review. */
const TRUSTED_BOTS = new Set([CODEX_LOGIN, GATE_LOGIN]);

/** How many times the gate asks Codex to review one commit. */
const MAX_CODEX_REQUESTS = 3;

/**
 * How long a Codex review can stay "in progress" before the gate treats it
 * as stopped and may ask again.
 */
const STALE_CODEX_MS = 60 * 60 * 1000;

/** How long the gate waits for Codex to start before it asks again. */
const RETRY_CODEX_AFTER_MS = 20 * 60 * 1000;

const API = "https://api.github.com";

type State = "success" | "pending" | "failure" | "error";

type CodexState = {
  commitSha: string | null;
  status: string | null;
  /** True when Codex reported findings on `commitSha`. */
  hasFindings: boolean;
};

export type ReviewThread = {
  isResolved: boolean;
  isOutdated: boolean;
  author: string | null;
  body: string;
  /** The commit the thread's first comment was made on. */
  commitSha: string | null;
};

export type GateInput = {
  author: string;
  draft: boolean;
  body: string | null;
  headSha: string;
  /** The parsed Codex summary comment, if Codex posted one. */
  codexState: CodexState | null;
  /** When Codex last edited that comment, in milliseconds. */
  codexStateUpdatedAt: number | null;
  /** The commits that Codex's submitted, not dismissed, reviews cover. */
  codexReviewedShas: string[];
  /** The commits whose Codex review a maintainer dismissed. */
  codexDismissedShas: string[];
  threads: ReviewThread[];
  /** This pull request's Claude status on the head commit, if any. */
  claudeStatus: {
    state: string;
    description: string;
    /** When it was set, in milliseconds. */
    updatedAt: number;
  } | null;
  /** How many Claude reviews of the head commit started. */
  claudeAttempts: number;
  /** True when the author has write access, or is Codex. */
  authorTrusted: boolean;
  /** The commits that a maintainer's review approved. */
  maintainerApprovedShas: string[];
  /** When the gate asked Codex to review the head commit, in milliseconds. */
  codexRequests: number[];
  /** The time of this run, in milliseconds. */
  now: number;
  /** Other open pull requests whose head is the same commit. */
  siblingPrs: number[];
  /** True when the base branch changed after the head commit was pushed. */
  baseChanged: boolean;
};

type Decision = {
  state: State;
  description: string;
  needsClaude: boolean;
  /** True when the Claude review job should run for the head commit. */
  claudeDue: boolean;
  requestCodex: boolean;
};

/**
 * True when the author or the footer names Codex. A false positive costs one
 * extra review, so the match is broad: any whole word "codex", or a link to
 * chatgpt.com/codex.
 */
export function codexHelped(body: string | null, author: string): boolean {
  if (/codex/i.test(author)) return true;
  const lines = (body ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const footer = lines.slice(-FOOTER_LINES).join("\n");
  return /\bcodex\b/i.test(footer) || /chatgpt\.com\/codex/i.test(footer);
}

/** Reads the `codex-review-state:v1` marker from Codex's summary comment. */
export function parseCodexState(body: string): CodexState | null {
  const match = body.match(/<!--\s*codex-review-state:v1\s+(\{.*?\})\s*-->/s);
  if (!match?.[1]) return null;
  try {
    const parsed = JSON.parse(match[1]) as {
      code_review?: {
        commit_sha?: unknown;
        status?: unknown;
        has_any_findings?: unknown;
      };
    };
    const review = parsed.code_review ?? {};
    return {
      commitSha:
        typeof review.commit_sha === "string" ? review.commit_sha : null,
      status: typeof review.status === "string" ? review.status : null,
      hasFindings: review.has_any_findings === true
    };
  } catch {
    return null;
  }
}

/**
 * The priority on a Codex finding: "P0" to "P3", or null when the comment
 * has no badge.
 */
function findingPriority(body: string): string | null {
  return body.match(/!\[(P[0-3]) Badge\]/)?.[1] ?? null;
}

function isCodexThread(thread: ReviewThread): boolean {
  // GraphQL gives a bot's login without "[bot]".
  return thread.author === CODEX_LOGIN.replace("[bot]", "");
}

/** Counts the Codex threads that block a merge. */
export function blockingCodexThreads(threads: ReviewThread[]): number {
  return threads.filter((thread) => {
    if (thread.isResolved || thread.isOutdated) return false;
    if (!isCodexThread(thread)) return false;
    const priority = findingPriority(thread.body);
    return priority === null || priority === "P0" || priority === "P1";
  }).length;
}

/** The priority that starts a Claude finding, such as "**P1**", or null. */
function claudePriority(body: string): string | null {
  return body.match(/^\s*\*\*(P[0-3])\*\*/)?.[1] ?? null;
}

/**
 * Counts the Claude findings that block a merge: unresolved threads, on lines
 * the head commit still has, that start with P0 or P1. Like Codex's, they
 * stop blocking when someone resolves them, so a recheck needs no new push.
 * `claude-verdict` checks that each blocker Claude counts has such a thread.
 */
export function blockingClaudeThreads(threads: ReviewThread[]): number {
  return threads.filter((thread) => {
    if (thread.author !== CLAUDE_THREAD_AUTHOR) return false;
    if (thread.isResolved || thread.isOutdated) return false;
    const priority = claudePriority(thread.body);
    return priority === "P0" || priority === "P1";
  }).length;
}

/** Reads the count from a Claude status description, "Reviewed: N ...". */
function reportedBlocking(description: string): number | null {
  const match = description.match(/^Reviewed: (\d+) /);
  return match?.[1] ? Number(match[1]) : null;
}

function findings(count: number): string {
  return `${count} unresolved P0/P1 finding${count === 1 ? "" : "s"}`;
}

/**
 * True when the gate should ask Codex for a review of the head commit: it has
 * not asked yet, or Codex has not started since its last request.
 */
export function shouldRequestCodex(requests: number[], now: number): boolean {
  if (requests.length === 0) return true;
  if (requests.length >= MAX_CODEX_REQUESTS) return false;
  return now - Math.max(...requests) >= RETRY_CODEX_AFTER_MS;
}

/** "done" when Codex finished a review of the head commit. */
function codexProgress(
  input: Pick<
    GateInput,
    | "headSha"
    | "codexState"
    | "codexStateUpdatedAt"
    | "codexReviewedShas"
    | "codexDismissedShas"
    | "now"
  >
): "done" | "running" | "none" {
  const { headSha, codexState } = input;
  // A submitted review is final. The summary comment can lag behind it, and
  // it stays at "running" if Codex fails to edit it.
  if (input.codexReviewedShas.includes(headSha)) return "done";
  // A dismissed review does not count, and the summary comment still says
  // "completed", so it must not stand in for the review.
  if (input.codexDismissedShas.includes(headSha)) return "none";
  if (codexState?.commitSha === headSha) {
    if (codexState.status === "completed") return "done";
    // A review that never finished counts as none, so the gate can ask
    // again, up to MAX_CODEX_REQUESTS times.
    const updated = input.codexStateUpdatedAt ?? input.now;
    return input.now - updated > STALE_CODEX_MS ? "none" : "running";
  }
  return "none";
}

export function decide(input: GateInput): Decision {
  const needsClaude = codexHelped(input.body, input.author);
  const base = { needsClaude, claudeDue: false, requestCodex: false };

  // A commit status belongs to a commit, not to a pull request, so a status
  // set for one pull request would also count for another with the same
  // head commit. The gate cannot tell them apart, so it passes neither.
  if (input.siblingPrs.length > 0) {
    const others = input.siblingPrs.map((n) => `#${n}`).join(", ");
    return {
      ...base,
      state: "failure",
      description: clip(
        `Another open PR (${others}) has the same head commit. Push a commit that only this PR has.`
      )
    };
  }

  if (EXEMPT_AUTHORS.has(input.author)) {
    return {
      ...base,
      needsClaude: false,
      state: "success",
      description: "Dependency update: no AI review needed."
    };
  }
  if (input.baseChanged) {
    return {
      ...base,
      state: "failure",
      description:
        "The base branch changed, so the reviews of this commit no longer count. Push a new commit."
    };
  }
  if (input.draft) {
    return {
      ...base,
      state: "pending",
      description: "Draft: AI review starts when the PR is ready."
    };
  }

  const problems: string[] = [];
  const waiting: string[] = [];

  const codex = codexProgress(input);
  const requestCodex =
    codex === "none" && shouldRequestCodex(input.codexRequests, input.now);
  if (codex === "done") {
    const blocking = blockingCodexThreads(input.threads);
    if (blocking > 0) {
      problems.push(`Codex: ${findings(blocking)}`);
    }
    // The threads are the only record of each finding's priority. If Codex
    // reports findings on the head commit but no thread shows one, a P0 or
    // P1 could be missing, so the gate does not pass.
    const reported =
      input.codexState?.commitSha === input.headSha &&
      input.codexState.hasFindings;
    const shown = input.threads.some(
      (t) => isCodexThread(t) && t.commitSha === input.headSha
    );
    if (reported && !shown) {
      problems.push(
        "Codex reported findings that no thread shows; comment to recheck"
      );
    }
  } else {
    waiting.push("Codex's review");
  }

  let claudeDue = false;
  const canRetry = input.claudeAttempts < MAX_CLAUDE_ATTEMPTS;
  const retryClaude = (problem: string) => {
    if (canRetry) {
      problems.push(problem);
      claudeDue = true;
    } else {
      problems.push(
        `${problem}, ${MAX_CLAUDE_ATTEMPTS} times; push a commit to try again`
      );
    }
  };
  if (needsClaude && !input.authorTrusted) {
    // Claude never reads an outside author's pull request.
    if (!input.maintainerApprovedShas.includes(input.headSha)) {
      waiting.push("a maintainer's approval, in place of Claude's review,");
    }
  } else if (needsClaude) {
    const status = input.claudeStatus;
    if (status === null) {
      waiting.push("Claude's review");
      claudeDue = true;
    } else if (status.state === "pending") {
      if (input.now - status.updatedAt > STALE_CLAUDE_MS) {
        // The job stopped before it recorded a verdict. Start a new one.
        retryClaude("Claude's review stopped without a verdict");
      } else {
        waiting.push("Claude's review");
      }
    } else if (status.state === "error") {
      // The review did not finish. The workflow starts a new one.
      retryClaude(`Claude's review did not finish (${status.description})`);
    } else if (status.state === "success") {
      if (reportedBlocking(status.description) === null) {
        problems.push(`Claude: unreadable status "${status.description}"`);
      }
      const blocking = blockingClaudeThreads(input.threads);
      if (blocking > 0) problems.push(`Claude: ${findings(blocking)}`);
    } else {
      problems.push(`Claude: ${status.description}`);
    }
  }

  const result = { needsClaude, claudeDue, requestCodex };
  if (problems.length > 0) {
    return {
      ...result,
      state: "failure",
      description: clip(`${problems.join("; ")}.`)
    };
  }
  if (waiting.length > 0) {
    return {
      ...result,
      state: "pending",
      description: clip(
        `Waiting for ${waiting.join(" and ")} of the head commit.`.replace(
          ", of",
          " of"
        )
      )
    };
  }
  return {
    ...result,
    state: "success",
    description: !needsClaude
      ? "Codex reviewed the head commit."
      : input.authorTrusted
        ? "Codex and Claude reviewed the head commit."
        : "Codex reviewed and a maintainer approved the head commit."
  };
}

type ClaudeVerdict =
  | { ok: true; blocking: number; summary: string }
  | { ok: false; error: string };

/** Checks the Claude review's structured output. Anything odd fails. */
export function parseClaudeVerdict(text: string | undefined): ClaudeVerdict {
  if (!text?.trim())
    return { ok: false, error: "review ended without a verdict" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "verdict is not JSON" };
  }
  const verdict = (parsed ?? {}) as { blocking?: unknown; summary?: unknown };
  if (
    typeof verdict.blocking !== "number" ||
    !Number.isInteger(verdict.blocking) ||
    verdict.blocking < 0
  ) {
    return { ok: false, error: "verdict has no blocking count" };
  }
  return {
    ok: true,
    blocking: verdict.blocking,
    summary: typeof verdict.summary === "string" ? verdict.summary : ""
  };
}

/** A commit status description holds at most 140 characters. */
function clip(text: string): string {
  return text.length <= 140 ? text : `${text.slice(0, 139)}…`;
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const dryRun = process.env.DRY_RUN === "1";

function headers(): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${env("GITHUB_TOKEN")}`,
    "User-Agent": "ai-review-gate",
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

async function github<T>(
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<T> {
  const response = await fetch(API + path, {
    method: init.method ?? "GET",
    headers: headers(),
    body: init.body === undefined ? null : JSON.stringify(init.body)
  });
  if (!response.ok) {
    throw new Error(
      `${init.method ?? "GET"} ${path}: ${response.status} ${await response.text()}`
    );
  }
  return (await response.json()) as T;
}

/** Follows the `Link: rel="next"` pages of a list endpoint. */
async function githubList<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  let url: string | null =
    `${API}${path}${path.includes("?") ? "&" : "?"}per_page=100`;
  while (url) {
    const response: Response = await fetch(url, { headers: headers() });
    if (!response.ok) {
      throw new Error(
        `GET ${url}: ${response.status} ${await response.text()}`
      );
    }
    items.push(...((await response.json()) as T[]));
    url =
      response.headers.get("link")?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ??
      null;
  }
  return items;
}

type ThreadsResponse = {
  data: {
    repository: {
      pullRequest: {
        reviewThreads: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: {
            isResolved: boolean;
            isOutdated: boolean;
            comments: {
              nodes: {
                author: { login: string } | null;
                body: string;
                originalCommit: { oid: string } | null;
              }[];
            };
          }[];
        };
      };
    };
  };
};

async function reviewThreads(
  owner: string,
  name: string,
  number: number
): Promise<ReviewThread[]> {
  const threads: ReviewThread[] = [];
  let after: string | null = null;
  do {
    const response: ThreadsResponse = await github<ThreadsResponse>(
      "/graphql",
      {
        method: "POST",
        body: {
          query: `query($owner: String!, $name: String!, $number: Int!, $after: String) {
          repository(owner: $owner, name: $name) {
            pullRequest(number: $number) {
              reviewThreads(first: 100, after: $after) {
                pageInfo { hasNextPage endCursor }
                nodes {
                  isResolved
                  isOutdated
                  comments(first: 1) {
                    nodes { author { login } body originalCommit { oid } }
                  }
                }
              }
            }
          }
        }`,
          variables: { owner, name, number, after }
        }
      }
    );
    const page = response.data.repository.pullRequest.reviewThreads;
    for (const node of page.nodes) {
      const first = node.comments.nodes[0];
      threads.push({
        isResolved: node.isResolved,
        isOutdated: node.isOutdated,
        author: first?.author?.login ?? null,
        body: first?.body ?? "",
        commitSha: first?.originalCommit?.oid ?? null
      });
    }
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return threads;
}

/** True when `login` can push to `repo`. Any error counts as no. */
async function canWrite(repo: string, login: string): Promise<boolean> {
  try {
    const { permission } = await github<{ permission: string }>(
      `/repos/${repo}/collaborators/${encodeURIComponent(login)}/permission`
    );
    return WRITE_PERMISSIONS.has(permission);
  } catch (err) {
    console.error(`No permission for ${login}: ${err}`);
    return false;
  }
}

function runUrl(): string | undefined {
  const server = process.env.GITHUB_SERVER_URL;
  const repo = process.env.GITHUB_REPOSITORY;
  const run = process.env.GITHUB_RUN_ID;
  return server && repo && run
    ? `${server}/${repo}/actions/runs/${run}`
    : undefined;
}

async function setStatus(
  repo: string,
  sha: string,
  context: string,
  state: State,
  description: string
): Promise<void> {
  console.error(`${context} on ${sha.slice(0, 7)}: ${state}: ${description}`);
  if (dryRun) return;
  await github(`/repos/${repo}/statuses/${sha}`, {
    method: "POST",
    body: {
      state,
      context,
      description: clip(description),
      target_url: runUrl()
    }
  });
}

async function writeOutputs(outputs: Record<string, string>): Promise<void> {
  const lines = Object.entries(outputs).map(
    ([key, value]) => `${key}=${value}\n`
  );
  const file = process.env.GITHUB_OUTPUT;
  if (file) await appendFile(file, lines.join(""));
  else process.stdout.write(lines.join(""));
}

async function gate(): Promise<void> {
  const repo = env("GITHUB_REPOSITORY");
  const [owner = "", name = ""] = repo.split("/");
  const number = Number(env("PR_NUMBER"));

  const pr = await github<{
    user: { login: string };
    draft: boolean;
    body: string | null;
    state: string;
    head: { sha: string };
    base: { ref: string };
  }>(`/repos/${repo}/pulls/${number}`);
  const headSha = pr.head.sha;
  if (pr.state !== "open") {
    // A status belongs to the commit, so another PR with this head, even
    // against another base, would inherit a `success`. Withdraw it.
    await setStatus(
      repo,
      headSha,
      GATE_CONTEXT,
      "pending",
      "The PR closed, so its reviews do not count for another PR."
    );
    console.error(`#${number} is ${pr.state}; nothing more to do.`);
    await writeOutputs({ head_sha: headSha, claude_due: "false" });
    return;
  }

  // A scheduled refresh (REFRESH=1) only changes a result. It skips the
  // pending status below and writes nothing when the result is the same,
  // so its runs do not fill the commit's status history.
  const refresh = process.env.REFRESH === "1";

  // GitHub uses the newest status of each context. If a read below fails,
  // an earlier `success` would stand, so withdraw it first.
  if (!refresh) {
    await setStatus(
      repo,
      headSha,
      GATE_CONTEXT,
      "pending",
      "Evaluating the AI reviews of the head commit."
    );
  }

  // Newest first, every page: the combined status holds only 30 contexts.
  const statuses = await githubList<{
    context: string;
    state: string;
    description: string | null;
    updated_at: string;
  }>(`/repos/${repo}/commits/${headSha}/statuses`);

  // Record the base before the other reads, which can fail.
  const record = statuses.find((s) => s.context === baseContext(number));
  const baseChanged =
    record !== undefined && record.description !== baseRecord(pr.base.ref);
  if (!record) {
    await setStatus(
      repo,
      headSha,
      baseContext(number),
      "success",
      baseRecord(pr.base.ref)
    );
  }

  const [comments, reviews, threads, commitPrs] = await Promise.all([
    githubList<{
      user: { login: string } | null;
      body: string;
      created_at: string;
      updated_at: string;
    }>(`/repos/${repo}/issues/${number}/comments`),
    githubList<Review>(`/repos/${repo}/pulls/${number}/reviews`),
    reviewThreads(owner, name, number),
    githubList<{ number: number; state: string; head: { sha: string } }>(
      `/repos/${repo}/commits/${headSha}/pulls`
    )
  ]);

  const codexComments = comments.filter((c) => c.user?.login === CODEX_LOGIN);
  const summaryComment = codexComments
    .filter((c) => parseCodexState(c.body) !== null)
    .at(-1);
  const summary = summaryComment ? parseCodexState(summaryComment.body) : null;
  const claude = statuses.find((s) => s.context === claudeContext(number));

  // Only the gate's own comments count as markers; anyone can post the text.
  const gateComments = comments.filter((c) => c.user?.login === GATE_LOGIN);

  // Only an approval of the head commit can count, so check only those
  // reviewers' permissions.
  let approvedByMaintainer = false;
  for (const login of approversOf(reviews, headSha)) {
    if (await canWrite(repo, login)) {
      approvedByMaintainer = true;
      break;
    }
  }
  const maintainerApprovedShas = approvedByMaintainer ? [headSha] : [];
  const authorTrusted =
    pr.user.login === CODEX_LOGIN || (await canWrite(repo, pr.user.login));

  const decision = decide({
    author: pr.user.login,
    draft: pr.draft,
    body: pr.body,
    headSha,
    codexState: summary,
    codexStateUpdatedAt: summaryComment
      ? Date.parse(summaryComment.updated_at)
      : null,
    // A dismissed review no longer counts.
    codexReviewedShas: reviews
      .filter((r) => r.user?.login === CODEX_LOGIN && r.state !== "DISMISSED")
      .map((r) => r.commit_id),
    codexDismissedShas: reviews
      .filter((r) => r.user?.login === CODEX_LOGIN && r.state === "DISMISSED")
      .map((r) => r.commit_id),
    threads,
    claudeStatus: claude
      ? {
          state: claude.state,
          description: claude.description ?? "",
          updatedAt: Date.parse(claude.updated_at)
        }
      : null,
    // The Claude job marks each start with a pending status.
    claudeAttempts: statuses.filter(
      (s) => s.context === claudeContext(number) && s.state === "pending"
    ).length,
    authorTrusted,
    maintainerApprovedShas,
    codexRequests: gateComments
      .filter((c) => c.body.includes(`${REQUEST_MARKER} ${headSha} -->`))
      .map((c) => Date.parse(c.created_at)),
    now: Date.now(),
    siblingPrs: commitPrs
      .filter(
        (p) =>
          p.number !== number && p.state === "open" && p.head.sha === headSha
      )
      .map((p) => p.number),
    baseChanged
  });

  // `statuses` is newest first.
  const current = statuses.find((s) => s.context === GATE_CONTEXT);
  const unchanged =
    current?.state === decision.state &&
    current.description === clip(decision.description);
  if (refresh && unchanged) {
    console.error(`#${number}: unchanged (${decision.state}).`);
  } else {
    await setStatus(
      repo,
      headSha,
      GATE_CONTEXT,
      decision.state,
      decision.description
    );
  }

  if (decision.requestCodex) {
    console.error(`Asking Codex to review ${headSha.slice(0, 7)}.`);
    if (!dryRun) {
      await github(`/repos/${repo}/issues/${number}/comments`, {
        method: "POST",
        body: {
          body: `@codex review\n\n${REQUEST_MARKER} ${headSha} -->`
        }
      });
    }
  }

  // The Claude action refuses an actor without write access, and each
  // refused start would use one of the commit's attempts. So only Codex, the
  // workflow's own token, and actors with write access start a review; the
  // refresh starts it for anyone else's event.
  const actor = process.env.TRIGGER_ACTOR;
  let claudeDue = decision.claudeDue;
  if (claudeDue && actor && !TRUSTED_BOTS.has(actor)) {
    if (!(await canWrite(repo, actor))) {
      console.error(`${actor} cannot start a Claude review; the refresh will.`);
      claudeDue = false;
    }
  }

  await writeOutputs({
    head_sha: headSha,
    claude_due: String(claudeDue)
  });
}

async function claudeVerdict(): Promise<void> {
  const repo = env("GITHUB_REPOSITORY");
  const headSha = env("HEAD_SHA");
  const context = claudeContext(Number(env("PR_NUMBER")));
  const verdict = parseClaudeVerdict(process.env.CLAUDE_VERDICT);
  if (!verdict.ok) {
    // `error`: the review did not finish, so the gate starts a new one
    // instead of treating this as a finding.
    await setStatus(repo, headSha, context, "error", verdict.error);
    return;
  }
  // The gate counts blockers from open threads, so each blocker Claude counts
  // must have one. If not, the review is incomplete: retry it.
  const [owner = "", name = ""] = repo.split("/");
  const open = blockingClaudeThreads(
    await reviewThreads(owner, name, Number(env("PR_NUMBER")))
  );
  if (verdict.blocking > open) {
    await setStatus(
      repo,
      headSha,
      context,
      "error",
      `counted ${verdict.blocking} P0/P1 findings but left ${open} open threads`
    );
    return;
  }
  // `success` means the review finished. The gate counts the blocking
  // findings from Claude's open threads, so resolving one can clear it.
  await setStatus(
    repo,
    headSha,
    context,
    "success",
    `Reviewed: ${verdict.blocking} P0/P1 finding${verdict.blocking === 1 ? "" : "s"}.`
  );
}

async function main(): Promise<void> {
  const [command] = process.argv.slice(2);
  if (command === "gate") return gate();
  if (command === "claude-verdict") return claudeVerdict();
  throw new Error("usage: ai-review-gate.ts gate | claude-verdict");
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
