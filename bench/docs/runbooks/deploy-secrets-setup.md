<!--
SPDX-License-Identifier: Apache-2.0
SPDX-FileCopyrightText: Copyright the Vortex contributors
-->

# Deploy & secrets ownership setup (benchmarks-website)

## Overview

This runbook is the one-time external setup that lets `vortex-data/benchmarks-website` own its own
deploys (Vercel) and schema-deploy (AWS OIDC → RDS), independent of the `vortex-data/vortex`
monorepo. The workflows already in this repo — `.github/workflows/web-deploy.yml`,
`.github/workflows/web-keep-warm.yml`, and `.github/workflows/schema-deploy.yml` — are already in
place and consume the secrets/vars listed here. Every step in this runbook is executed by an
operator (via web console or CLI); the workflows themselves do not drive the setup.

**Secrets-handling rule:** never commit a secret value to the repository. Set values only in the
Vercel project env, GitHub Actions secrets, or AWS — this document lists names and where to copy
values from, never values themselves.

**Related documentation (cross-reference — do not duplicate):**
- [`infra/README.md`](../../infra/README.md) — RDS Postgres + RDS Proxy + OIDC provisioning
  history and bootstrap procedure for account `245040174862`.
- [`migrations/README.md`](../../migrations/README.md) — schema migration bootstrap ordering,
  `requires-superuser` marker contract, and `migrator` role history.

## Prerequisites

Before starting, confirm you have:

- **Vercel team/org access** with permission to create new projects (project-creator or owner role).
- **GitHub repo admin** on `vortex-data/benchmarks-website` (to set Actions secrets and vars).
- **AWS IAM permissions** on account `245040174862` to edit the OIDC trust policy
  (`iam:UpdateAssumeRolePolicy` on `GitHubBenchmarkSchemaRole` — the only role this runbook modifies;
  `GitHubBenchmarkIngestRole` is left unchanged in Phase 4, see the note at the end of Section D.4).
- CLI tools authenticated:
  - `gh` — `gh auth status` shows `vortex-data/benchmarks-website` accessible.
  - `vercel` — `vercel whoami` shows the correct team/org.
  - `aws` — `aws sts get-caller-identity` returns account `245040174862`.
  - Or use the respective web consoles (Vercel Dashboard, GitHub Settings, AWS IAM console) for
    each step — all steps describe both paths.

---

## A. Create the new Vercel project

**Rationale (decision (d)):** This repo deploys to a NEW Vercel project it owns — not the
`vortex-data/vortex` monorepo's existing project. Vercel CLI deploys are keyed by
`VERCEL_PROJECT_ID`; the monorepo's `web-deploy.yml` still fires on its own project (we touch
nothing there). Sharing the project would race: two repos pushing to the same project ID can
interleave build slots and overwrite each other's deployments. A new project is the only race-free,
monorepo-untouched path. The monorepo's project is retired in future work; the Phase-5 DNS cutover
will point production at the winning project at that time.

1. **Create the project.**

   - **Dashboard path:** Vercel Dashboard → New Project → Import Git Repository →
     `vortex-data/benchmarks-website`. When prompted for configuration:
     - Set **Root Directory** = `web/` (the Next.js app lives there; `web/vercel.json` is the
       project config file Vercel reads for cron, headers, and other project settings).
     - Framework preset: Next.js (auto-detected from `web/package.json`).
   - **CLI path (from `web/`):**
     ```sh
     cd web
     vercel link   # follow prompts: create new project, set root = web/
     ```

2. **Disable Git integration** on the new project immediately after creation.

   Vercel's default Git integration would auto-deploy on every push to the repo. This repo's deploy
   is driven exclusively by `.github/workflows/web-deploy.yml` via `vercel deploy --prebuilt` — a
   Vercel-side auto-build would race that workflow and produce duplicate, unsynchronized deployments.

   - **Dashboard path:** Project Settings → Git → Disconnect Git Repository (or "Disable Auto
     Deployments" if available).
   - Confirm: after disconnecting, pushing a commit to this repo must NOT trigger a Vercel build in
     the project's deployment list.

3. **Note the project's generated domains.**

   After creation, Vercel assigns a preview domain (e.g. `benchmarks-website-<hash>.vercel.app`) and
   optionally a production domain. Record these for the keep-warm smoke-test later (Section E.4).

4. **Record `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`.**

   After `vercel link`, both IDs are written to `web/.vercel/project.json`. Read them from there, or
   from Project Settings → General in the Vercel Dashboard.

   ```sh
   cat web/.vercel/project.json
   # {"orgId": "...", "projectId": "..."}
   ```

   - These are non-sensitive identifiers (not secrets). They become GitHub Actions **variables**
     (not secrets) in Section C.
   - **Do NOT commit `web/.vercel/`** — confirm it is listed in `.gitignore` (it should be; verify
     with `git check-ignore -v web/.vercel/project.json`).

5. **Create a Vercel access token.**

   The deploy workflow authenticates with a Vercel API token (this is separate from the project —
   it is NOT produced by project creation). Create one and copy its value to your secret store; it
   becomes the `VERCEL_TOKEN` GitHub secret in Section C.1.

   - **Dashboard path:** Vercel → Account Settings (or Team Settings) → Tokens → Create Token →
     give it a name (e.g. `benchmarks-website-deploy`), scope it to the team/project that owns the
     new project, set an expiration per your policy → Create → copy the value (shown once).
   - Treat the value as a secret: paste it straight into your secret store / the Section C.1 `gh
     secret set` prompt. Never write it into a file.

---

## B. Set the Vercel project environment variables

In the new project's **Production AND Preview** environments, set the following variables. These are
consumed by `web/lib/db.ts` (database connection pool) and `web/app/api/revalidate/route.ts`
(cache revalidation bearer).

Copy values from the existing monorepo-owned Vercel project's environment settings, or from your
team's secret store. **Never paste a value into this document.**

| Name | Purpose | Copy value from |
|---|---|---|
| `BENCH_DB_HOST` | RDS instance (or proxy) hostname for the read pool | Existing monorepo Vercel project env, or `infra/README.md` "After provisioning" section |
| `BENCH_DB_NAME` | Postgres database name (`vortex_bench`) | Existing monorepo Vercel project env |
| `BENCH_DB_USER` | Postgres username for the read role (`bench_read`) | Existing monorepo Vercel project env |
| `BENCH_DB_PASSWORD` | Static password for the `bench_read` role (IAM auth bypass for Vercel) | Existing monorepo Vercel project env or your secret store |
| `BENCH_DB_PORT` | Postgres port (default `5432`; omit to use default) | Existing monorepo Vercel project env |
| `BENCH_DB_REGION` | AWS region for IAM token generation (e.g. `us-east-1`); required when `BENCH_DB_PASSWORD` is unset | Existing monorepo Vercel project env |
| `BENCH_DB_SSL` | TLS verification mode (`verify-full` for RDS production, `disable` for local dev only) | Existing monorepo Vercel project env |
| `BENCH_DB_CA` | RDS CA bundle PEM content or mode; required for `verify-full` — Node does not include Amazon RDS roots in its trust store | Existing monorepo Vercel project env or [Amazon RDS CA bundle](https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem) |
| `BENCH_DB_POOL_MAX` | Max connections in the pg pool (default `8`; omit to use default) | Existing monorepo Vercel project env |
| `BENCH_DB_IDLE_TIMEOUT_MS` | Pool idle-connection timeout in ms (default `300000` = 5 min; omit to use default) | Existing monorepo Vercel project env |
| `BENCH_REVALIDATE_TOKEN` | Bearer token for `POST /api/revalidate` — must match the value the monorepo's emitter caller (`post-ingest.py`) sends | Existing monorepo Vercel project env; coordinate with the monorepo caller (see note below) |

> **`BENCH_REVALIDATE_TOKEN` coordination:** this token authenticates the monorepo's `post-ingest.py`
> revalidation caller against `POST /api/revalidate`. Setting it on the new project only makes the new
> project ACCEPT a matching bearer — it does **not** redirect the emitter's traffic here. The emitter
> POSTs to whatever base URL it is configured with (currently the monorepo-owned project's domain), so
> until that target URL is repointed at this project (at the Phase-5 DNS cutover, or by updating the
> emitter's configured URL), revalidation traffic continues to hit the **old** project — that is
> expected during the Phase-4 setup window. Use the SAME token value the monorepo caller sends; if you
> rotate it, update it in both places: this Vercel project and the monorepo's secret that feeds
> `post-ingest.py`.

> **`BENCH_DATA_TAG` is not env-configurable:** the Next.js Data Cache tag is a compile-time constant
> (`export const BENCH_DATA_TAG = 'bench-data'` in `web/lib/data-cache.ts`), imported directly by
> `web/app/api/revalidate/route.ts` — nothing reads `process.env.BENCH_DATA_TAG`. Do **not** set it as
> a Vercel env var (it would be a no-op). To change the tag, edit the source constant and redeploy.

To set variables via CLI (repeat for each name; example for `BENCH_DB_HOST`):

```sh
# Set for both Production and Preview environments:
vercel env add BENCH_DB_HOST production
vercel env add BENCH_DB_HOST preview
# vercel prompts for the value interactively — paste from your secret store, do not write it here
```

Or use the Vercel Dashboard: Project → Settings → Environment Variables → Add.

After setting all variables, verify via **Section E** in order: `E.1` builds the project and `E.3`
runs the first real deploy (`web-deploy.yml`). Only after `E.3` are there deployed functions to
inspect — then check the Vercel function logs for any `Missing required environment variable` errors
from `web/lib/db.ts`; a successful `/api/health` response confirms the pool is connected.

---

## C. Set this repo's GitHub Actions secrets and variables

In `vortex-data/benchmarks-website` → Settings → Secrets and variables → Actions, configure one
secret and seven variables. **Secrets** are masked in logs; **variables** are plain identifiers that
are safe to expose in log output.

### C.1 Secret

| Name | Purpose |
|---|---|
| `VERCEL_TOKEN` | Vercel access token with deploy scope on the new project (created in Section A, step 5) |

Set via `gh` CLI — the operator pastes the value at the interactive prompt; the value is never
echoed on the command line or stored in shell history:

```bash
gh secret set VERCEL_TOKEN --repo vortex-data/benchmarks-website   # prompts for the value (not echoed)
```

**Dashboard path:** Settings → Secrets and variables → Actions → New repository secret → Name:
`VERCEL_TOKEN`.

### C.2 Variables

Variables hold non-sensitive identifiers. Use `--body` to pass the value inline (safe because these
are not secrets):

```bash
# Vercel project identifiers — copy from web/.vercel/project.json (recorded in Section A)
gh variable set VERCEL_ORG_ID        --repo vortex-data/benchmarks-website --body "<org id from Section A>"
gh variable set VERCEL_PROJECT_ID    --repo vortex-data/benchmarks-website --body "<project id from Section A>"
gh variable set BENCH_SITE_BASE_URL  --repo vortex-data/benchmarks-website --body "https://<new project public URL>"

# AWS OIDC role ARN for schema-deploy.yml
gh variable set GH_BENCH_SCHEMA_ROLE_ARN  --repo vortex-data/benchmarks-website --body "arn:aws:iam::245040174862:role/GitHubBenchmarkSchemaRole"

# RDS connection coordinates for schema-deploy.yml
gh variable set RDS_BENCH_REGION            --repo vortex-data/benchmarks-website --body "<rds region>"
gh variable set RDS_BENCH_INSTANCE_ENDPOINT --repo vortex-data/benchmarks-website --body "<rds instance endpoint host>"
gh variable set RDS_BENCH_DB_NAME           --repo vortex-data/benchmarks-website --body "<rds db name>"
```

**Dashboard path:** Settings → Secrets and variables → Actions → Variables tab → New repository
variable.

**Workflow consumers:**

| Variable | Consumed by |
|---|---|
| `VERCEL_TOKEN` (secret) | `web-deploy.yml` |
| `VERCEL_ORG_ID` | `web-deploy.yml` |
| `VERCEL_PROJECT_ID` | `web-deploy.yml` |
| `BENCH_SITE_BASE_URL` | `web-keep-warm.yml` |
| `GH_BENCH_SCHEMA_ROLE_ARN` | `schema-deploy.yml` |
| `RDS_BENCH_REGION` | `schema-deploy.yml` |
| `RDS_BENCH_INSTANCE_ENDPOINT` | `schema-deploy.yml` |
| `RDS_BENCH_DB_NAME` | `schema-deploy.yml` |

> **Note on `GH_BENCH_SCHEMA_ROLE_ARN`:** the literal ARN above uses account `245040174862` and role
> name `GitHubBenchmarkSchemaRole`. Confirm these against the existing monorepo config (e.g.
> `infra/README.md` or the monorepo's GitHub Actions variables) if there is any discrepancy before
> setting.

---

## D. Extend the AWS IAM OIDC trust to this repo

### D.1 Background

The GitHub-OIDC roles in AWS account `245040174862` —

- `GitHubBenchmarkSchemaRole` — assumed by `schema-deploy.yml` to apply incremental migrations via
  the `migrator` Postgres role.
- `GitHubBenchmarkIngestRole` — assumed by the v4 ingest pipeline (lives in the monorepo).

Both roles trust the GitHub OIDC provider (`token.actions.githubusercontent.com`). Their current
trust policy's `StringLike` condition allows only `repo:vortex-data/vortex:*` to assume them.

### D.2 Goal

Add `repo:vortex-data/benchmarks-website:*` to the trust condition so this repo's Actions workflows
can assume `GitHubBenchmarkSchemaRole`. **Do NOT remove the existing monorepo entry** —
`repo:vortex-data/vortex:*` must remain in place so the monorepo's ingest pipeline and any other
consumers continue to work during the cutover window.

### D.3 Required trust-policy `Condition` shape

After the edit, the trust-policy `Statement` for `GitHubBenchmarkSchemaRole` must look like this (the
`sub` claim becomes a list; apply the same shape to `GitHubBenchmarkIngestRole` only if/when it is
later brought in scope — see D.4):

```json
{
  "Effect": "Allow",
  "Principal": { "Federated": "arn:aws:iam::245040174862:oidc-provider/token.actions.githubusercontent.com" },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": {
    "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
    "StringLike": {
      "token.actions.githubusercontent.com:sub": [
        "repo:vortex-data/vortex:*",
        "repo:vortex-data/benchmarks-website:*"
      ]
    }
  }
}
```

### D.4 CLI path (idempotent — fetch, edit, put-back)

Apply to `GitHubBenchmarkSchemaRole` (required for Phase 4):

```bash
# 1. Fetch the current trust document
aws iam get-role --role-name GitHubBenchmarkSchemaRole \
  --query 'Role.AssumeRolePolicyDocument' --output json > /tmp/schema-trust.json

# 2. Edit /tmp/schema-trust.json:
#    In the StringLike condition, change the "sub" value from a single string to the list shown in
#    D.3 above. Keep the existing "repo:vortex-data/vortex:*" entry; add the new entry below it.

# 3. Apply the updated policy
aws iam update-assume-role-policy --role-name GitHubBenchmarkSchemaRole \
  --policy-document file:///tmp/schema-trust.json
```

**Dashboard path (alternative):** AWS IAM console → Roles → `GitHubBenchmarkSchemaRole` → Trust
relationships → Edit trust policy → update the `sub` value to the list above → Update policy.

> **`GitHubBenchmarkIngestRole`:** apply the same edit only if this repo will also drive v4 ingest
> from CI. That is out of scope for Phase 4 — `schema-deploy.yml` is the only OIDC consumer added
> this phase. Leave `GitHubBenchmarkIngestRole` unchanged for now unless explicitly planned.

### D.5 Bootstrap caveat — superuser migrations must precede OIDC role usage

**Cross-reference: `migrations/README.md` § Bootstrap ordering.**

The `migrator` Postgres role (assumed via OIDC by `schema-deploy.yml`) is `NOSUPERUSER`. Several
migrations are marked `requires-superuser`:

- `002`, `004`, `005`, `006`, `007`

These migrations **must be applied by the RDS master user out-of-band** before `schema-deploy.yml`
can run incremental applies. The runner's preflight check will refuse any `requires-superuser`-marked
file that has not already been applied, raising a clear `PermissionError` and halting the workflow.

**Action required before first `schema-deploy.yml` run:**

1. Connect to RDS as the master user (see `migrations/README.md` for the connection procedure).
2. Run the **full bootstrap apply as master** — `migrate-schema.py apply` applies every migration
   (`001`–`007`) in order: it creates the `migrator` role (`002`), grants it ledger access (`003`,
   which `migrator` needs to read/write `_applied_migrations` from CI), and applies the other
   `requires-superuser` files (`004`–`007`). Do NOT hand-apply only the marked subset — that would
   leave `003` ungranted, and the later CI dry-run/apply could not read the ledger.
3. Only after that full bootstrap apply is recorded may `schema-deploy.yml` be triggered for any
   subsequent migration.

See `migrations/README.md` § Bootstrap ordering for the authoritative procedure and the full list
of master-applied files.

---

## E. Verify the setup

Run these checks after completing Sections A–D. They exercise each integration path end-to-end and
surface misconfiguration before production traffic is at risk. All checks below are safe to run at
any time — none writes to production data or changes deployed infrastructure.

### E.1 Vercel build (CLI auth + project link)

This mirrors what `web-deploy.yml` does: the workflow runs the Vercel CLI from the **repo root** with
`VERCEL_ORG_ID` + `VERCEL_PROJECT_ID` exported as env (the project's Root Directory = `web/` setting
makes the CLI build `web/`). Reproduce that exact resolution path so the check actually exercises the
GitHub **variables** you set in Section C — running `vercel` from inside `web/` would instead resolve
the project from `web/.vercel/project.json` and could pass even when the Actions variables are wrong.
`VERCEL_TOKEN` is a GitHub Actions secret, not a local env var — export it too, otherwise an empty
`--token=""` silently falls back to your local `vercel login` session and tests the wrong credential:

```bash
export VERCEL_ORG_ID="<org id from Section A>"          # the value you set as the GitHub variable
export VERCEL_PROJECT_ID="<project id from Section A>"
read -rs VERCEL_TOKEN && export VERCEL_TOKEN            # paste at the prompt; never echoed, never recorded in shell history
# Run from the REPO ROOT (not web/) to match the workflow's project-resolution path:
vercel pull --yes --environment=preview --token="$VERCEL_TOKEN" && vercel build --token="$VERCEL_TOKEN"
unset VERCEL_TOKEN                                      # drop the secret from the environment when done
```

**Expected:** exits `0`. `vercel pull` resolves the project from the exported IDs and pulls its env;
`vercel build` produces a `.vercel/output/` artifact.

**If non-zero:** the `VERCEL_*` values are wrong. Check that `VERCEL_PROJECT_ID` matches the project
created in Section A (not the monorepo's project ID), and that `VERCEL_TOKEN` has deploy scope on it.

> The full GitHub-Actions credential path (the `VERCEL_TOKEN` *secret* plus the variables, exactly as
> the workflow consumes them) is validated end-to-end by **E.3** below, not by this local check.

### E.2 Schema-deploy OIDC → IAM → RDS dry run

This confirms that the OIDC trust extension (Section D) works, the role ARN and RDS connection
coordinates (Section C) are correct, and the `migrator` Postgres user can connect with
`sslmode=verify-full`.

Trigger `schema-deploy.yml` via `workflow_dispatch` with `dry_run: true`:

- **GitHub Actions UI path:** Actions → `schema-deploy` → Run workflow → set `dry_run` = `true` →
  Run workflow.
- **CLI path:**
  ```bash
  gh workflow run schema-deploy.yml -f dry_run=true --repo vortex-data/benchmarks-website
  ```

**Expected:** the job assumes `GitHubBenchmarkSchemaRole`, opens a connection to RDS as `migrator`
with `sslmode=verify-full`, and prints the current migration status. A `status`-drift exit (the
workflow reports pending migrations but does not apply them) is normal and informational in dry-run
mode — the workflow does not fail on drift, it reports. The job exits `0`.

**If OIDC or connection failure:** check the trust extension in Section D (the
`repo:vortex-data/benchmarks-website:*` entry must be present), the `GH_BENCH_SCHEMA_ROLE_ARN`
variable value, and the `RDS_BENCH_*` connection coordinates. The job log will identify the failing
step.

> **Bootstrap note (dry-run vs apply):** both the dry-run and the apply assume the master has already
> run the full bootstrap apply (Section D.5). The dry-run connects as `migrator` and reads the
> `_applied_migrations` ledger, so it needs the `migrator` role (`002`) and its ledger grant (`003`)
> in place — without the bootstrap the job fails at connection or ledger-read time, not at a preflight.
> The dry-run does NOT require the later `requires-superuser` migrations to be applied: it reports any
> unapplied ones as pending (drift) and still exits `0`, and it never raises `PermissionError`.
> `PermissionError` is the `requires-superuser` preflight and fires ONLY on the non-dry `apply` path
> (when a marked migration is reached by the non-master `migrator` role). See Section D.5 and
> `migrations/README.md` § Bootstrap ordering.

### E.3 Web deploy end-to-end (GitHub Actions credential path)

This validates the full deploy pipeline as the workflow runs it — the `VERCEL_TOKEN` **secret** plus
the `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` **variables**, consumed by `web-deploy.yml` from the repo
root. (E.1's local build does not exercise the Actions secret/variable path.) It also produces the
first deployment that E.4's keep-warm check needs — run it before E.4.

Trigger a preview deploy via `workflow_dispatch`:

- **GitHub Actions UI path:** Actions → `Web Deploy` → Run workflow → set `environment` = `preview` →
  Run workflow.
- **CLI path:**
  ```bash
  gh workflow run web-deploy.yml -f environment=preview --repo vortex-data/benchmarks-website
  ```

**Expected:** the job runs `vercel pull` / `vercel build` / `vercel deploy --prebuilt` and prints a
preview deployment URL; the job exits `0`. Open the URL and confirm the site renders.

**If it fails:** a Vercel auth error means the `VERCEL_TOKEN` secret is missing or wrong-scoped; a
"project not found" error means `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` are wrong (Section C.2). The job
log identifies the failing step.

### E.4 Keep-warm health-check (optional)

After at least one deploy has landed (E.3) and `BENCH_SITE_BASE_URL` is set, `web-keep-warm.yml` pings
`/api/health` on its schedule. To confirm it works immediately:

```bash
gh workflow run web-keep-warm.yml --repo vortex-data/benchmarks-website
```

**Expected:** the job GETs `$BENCH_SITE_BASE_URL/api/health` and receives HTTP `200`. A non-200 or
connection error means the URL in `BENCH_SITE_BASE_URL` does not match the deployed project's
domain (confirm against the domain noted in Section A, step 3).

---

## Rollback / cutover note

This setup is fully additive:

- **New Vercel project** — the monorepo's existing Vercel project is not touched. Its Git
  integration, environment variables, and deployment history are unchanged.
- **OIDC trust extension** — the IAM trust policy edit adds `benchmarks-website` as a subject; it
  does not remove `repo:vortex-data/vortex:*`. The monorepo's ingest pipeline and any other OIDC
  consumers continue to work without interruption.

It is therefore safe to complete all steps in this runbook before the production DNS cutover. No
traffic is moved by this runbook — DNS cutover is a separate, later effort (Phase 5). If anything
goes wrong before cutover, removing the new Vercel project and reverting the trust-policy edit
returns the system to its pre-runbook state with no impact on users.
