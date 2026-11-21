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
 *   pending  a required review of the head commit is not there yet, or the
 *            pull request is a draft
 *   failure  a required review has a blocking finding
 *
 * A blocking finding is a P0 or P1 finding. For Codex, it is an unresolved
 * review thread that Codex started, on a line the head commit still has (not
 * outdated), with a P0 or P1 badge or with no badge. For Claude, it is the
 * `blocking` count in the review's structured output (its verdict).
 *
 * Commands:
 *   gate                   evaluate the pull request, set the status, ask
 *                          Codex for a review of the head commit if it has
 *                          none, and write `head_sha` and `claude_due` to
 *                          GITHUB_OUTPUT
 *   claude-verdict         read the Claude review's verdict from
 *                          CLAUDE_VERDICT and set the
 *                          `AI cross-review / Claude` status on HEAD_SHA
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
 *   DRY_RUN=1          print what the gate would do and write nothing
 */

import { appendFile } from "node:fs/promises";

const GATE_CONTEXT = "AI cross-review";
const CLAUDE_CONTEXT = "AI cross-review / Claude";
const CODEX_LOGIN = "chatgpt-codex-connector[bot]";

/** Authors whose pull requests need no AI review: dependency updates. */
const EXEMPT_AUTHORS = new Set(["renovate[bot]", "dependabot[bot]"]);

/** How many non-empty lines at the end of the body count as the footer. */
const FOOTER_LINES = 5;

/** The hidden marker on the gate's own `@codex review` comments. */
const REQUEST_MARKER = "<!-- ai-review-gate:codex-requested";

const API = "https://api.github.com";

type State = "success" | "pending" | "failure";

type CodexState = {
  commitSha: string | null;
  status: string | null;
};

export type ReviewThread = {
  isResolved: boolean;
  isOutdated: boolean;
  author: string | null;
  body: string;
};

export type GateInput = {
  author: string;
  draft: boolean;
  body: string | null;
  headSha: string;
  /** The parsed Codex summary comment, if Codex posted one. */
  codexState: CodexState | null;
  /** The commits that Codex's submitted reviews cover. */
  codexReviewedShas: string[];
  threads: ReviewThread[];
  /** The `AI cross-review / Claude` status on the head commit, if any. */
  claudeStatus: { state: string; description: string } | null;
  /** True when the gate already asked Codex to review the head commit. */
  codexRequested: boolean;
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
      code_review?: { commit_sha?: unknown; status?: unknown };
    };
    const review = parsed.code_review ?? {};
    return {
      commitSha:
        typeof review.commit_sha === "string" ? review.commit_sha : null,
      status: typeof review.status === "string" ? review.status : null
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

/** Counts the Codex threads that block a merge. */
export function blockingCodexThreads(threads: ReviewThread[]): number {
  return threads.filter((thread) => {
    if (thread.isResolved || thread.isOutdated) return false;
    if (thread.author !== CODEX_LOGIN.replace("[bot]", "")) return false;
    const priority = findingPriority(thread.body);
    return priority === null || priority === "P0" || priority === "P1";
  }).length;
}

/** "done" when Codex finished a review of the head commit. */
function codexProgress(
  input: Pick<GateInput, "headSha" | "codexState" | "codexReviewedShas">
): "done" | "running" | "none" {
  const { headSha, codexState } = input;
  if (codexState?.commitSha === headSha) {
    return codexState.status === "completed" ? "done" : "running";
  }
  if (input.codexReviewedShas.includes(headSha)) return "done";
  return "none";
}

export function decide(input: GateInput): Decision {
  const needsClaude = codexHelped(input.body, input.author);
  const base = { needsClaude, claudeDue: false, requestCodex: false };

  if (EXEMPT_AUTHORS.has(input.author)) {
    return {
      ...base,
      needsClaude: false,
      state: "success",
      description: "Dependency update: no AI review needed."
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
  const requestCodex = codex === "none" && !input.codexRequested;
  if (codex === "done") {
    const blocking = blockingCodexThreads(input.threads);
    if (blocking > 0) {
      problems.push(
        `Codex: ${blocking} unresolved P0/P1 finding${blocking === 1 ? "" : "s"}`
      );
    }
  } else {
    waiting.push("Codex");
  }

  let claudeDue = false;
  if (needsClaude) {
    const status = input.claudeStatus;
    if (status === null) {
      waiting.push("Claude");
      claudeDue = true;
    } else if (status.state === "pending") {
      waiting.push("Claude");
    } else if (status.state !== "success") {
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
      description: `Waiting for ${waiting.join(" and ")} to review the head commit.`
    };
  }
  return {
    ...result,
    state: "success",
    description: needsClaude
      ? "Codex and Claude reviewed the head commit."
      : "Codex reviewed the head commit."
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
              nodes: { author: { login: string } | null; body: string }[];
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
                  comments(first: 1) { nodes { author { login } body } }
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
        body: first?.body ?? ""
      });
    }
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return threads;
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
  }>(`/repos/${repo}/pulls/${number}`);
  const headSha = pr.head.sha;
  if (pr.state !== "open") {
    console.error(`#${number} is ${pr.state}; nothing to do.`);
    await writeOutputs({ head_sha: headSha, claude_due: "false" });
    return;
  }

  const [comments, reviews, threads, combined] = await Promise.all([
    githubList<{ user: { login: string } | null; body: string }>(
      `/repos/${repo}/issues/${number}/comments`
    ),
    githubList<{ user: { login: string } | null; commit_id: string }>(
      `/repos/${repo}/pulls/${number}/reviews`
    ),
    reviewThreads(owner, name, number),
    github<{
      statuses: {
        context: string;
        state: string;
        description: string | null;
      }[];
    }>(`/repos/${repo}/commits/${headSha}/status`)
  ]);

  const codexComments = comments.filter((c) => c.user?.login === CODEX_LOGIN);
  const summary = codexComments
    .map((c) => parseCodexState(c.body))
    .filter((state): state is CodexState => state !== null)
    .at(-1);
  const claude = combined.statuses.find((s) => s.context === CLAUDE_CONTEXT);

  const decision = decide({
    author: pr.user.login,
    draft: pr.draft,
    body: pr.body,
    headSha,
    codexState: summary ?? null,
    codexReviewedShas: reviews
      .filter((r) => r.user?.login === CODEX_LOGIN)
      .map((r) => r.commit_id),
    threads,
    claudeStatus: claude
      ? { state: claude.state, description: claude.description ?? "" }
      : null,
    codexRequested: comments.some((c) =>
      c.body.includes(`${REQUEST_MARKER} ${headSha}`)
    )
  });

  await setStatus(
    repo,
    headSha,
    GATE_CONTEXT,
    decision.state,
    decision.description
  );

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

  await writeOutputs({
    head_sha: headSha,
    claude_due: String(decision.claudeDue)
  });
}

async function claudeVerdict(): Promise<void> {
  const repo = env("GITHUB_REPOSITORY");
  const headSha = env("HEAD_SHA");
  const verdict = parseClaudeVerdict(process.env.CLAUDE_VERDICT);
  if (!verdict.ok) {
    await setStatus(repo, headSha, CLAUDE_CONTEXT, "failure", verdict.error);
    return;
  }
  const { blocking } = verdict;
  await setStatus(
    repo,
    headSha,
    CLAUDE_CONTEXT,
    blocking === 0 ? "success" : "failure",
    blocking === 0
      ? "no blocking findings"
      : `${blocking} P0/P1 finding${blocking === 1 ? "" : "s"}`
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
