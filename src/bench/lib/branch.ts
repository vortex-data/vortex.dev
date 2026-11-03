// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

/**
 * The branch the site charts. Migration 012 records each commit's branch on
 * `commits.branch`; reads see only this branch's commits, so numbers measured on
 * any other branch never reach a chart, a summary, or a commit window.
 */
export const READ_BRANCH = 'develop';

if (!/^[A-Za-z0-9._/-]+$/.test(READ_BRANCH)) {
  throw new Error(`READ_BRANCH is spliced into SQL and must be a plain branch name`);
}

/** `alias.branch = '<READ_BRANCH>'`, for a `commits` row named `alias`. */
export function onReadBranch(alias: string): string {
  return `${alias}.branch = '${READ_BRANCH}'`;
}

/**
 * `commits` restricted to [`READ_BRANCH`], usable wherever the table name is.
 * Postgres flattens the subquery, so the planner sees a plain filtered scan.
 */
export const BRANCH_COMMITS = `(SELECT * FROM commits WHERE branch = '${READ_BRANCH}')`;

/** `alias.commit_sha` is one of [`READ_BRANCH`]'s commits, for a fact row that skips the join. */
export function factOnReadBranch(alias: string): string {
  return `${alias}.commit_sha IN (SELECT commit_sha FROM commits WHERE branch = '${READ_BRANCH}')`;
}
