<!--
SPDX-License-Identifier: CC-BY-4.0
SPDX-FileCopyrightText: Copyright the Vortex contributors
-->

# bench/infra

AWS infrastructure for bench (RDS Postgres, its backups and alarms, and GitHub Actions OIDC). One-shot bootstrap, idempotent re-run, fully scripted.

This directory provisions the live v4 stack (the v3 ops tree it once sat beside is decommissioned and deleted). The Vercel reader's deploy hooks live with the Next.js app at `bench/web/` and not here. To restore the database, see [RESTORE.md](RESTORE.md).

## What `provision.sh` builds

Single one-shot script. Provisions, in order:

1. The default-VPC subnet group covering every default subnet in `us-east-1` (`vortex-bench-subnet-group`).
2. A security group `vortex-bench-sg` with inbound TCP 5432 from `0.0.0.0/0` — IAM auth is the gate, not network ACLs.
3. A DB parameter group `vortex-bench-pg16` (family `postgres16`) that sets `work_mem` to 32 MiB and turns on `log_connections` and `log_disconnections`, and the CloudWatch log group `/aws/rds/instance/vortex-bench-prod/postgresql` with 30-day retention. The instance exports its Postgres log there. See [Logs](#logs).
4. An RDS Postgres instance `vortex-bench-prod` on `db.t4g.micro`, Postgres 16, 20 GiB GP3 storage that autoscales to 100 GiB, IAM auth enabled, RDS-managed master password (auto-rotated, stored in Secrets Manager), publicly accessible, single-AZ, deletion protection, automatic minor upgrades, 35-day backup window. On an instance that already exists, the script sets deletion protection, the storage ceiling, the backup window and automatic minor upgrades; these apply without a restart. It does not move an existing instance to another parameter group or change an existing backup replication, because a parameter group needs a restart and a new replication starts a new off-region copy. It prints the commands instead.
5. Replication of the automated backups (daily snapshots and WAL) to `us-west-2`, with 14 days of point-in-time recovery there. See [Backups](#backups).
6. An SNS topic `vortex-bench-alarms`, three CloudWatch alarms and an RDS event subscription. See [Alarms](#alarms).
7. The GitHub OIDC provider `token.actions.githubusercontent.com` (account-scoped — created once if not present).
8. An IAM role `GitHubBenchmarkSchemaRole` trusted to GitHub Actions OIDC for `vortex-data/vortex.dev` on `main` with `sts:AssumeRoleWithWebIdentity`. Permission policy: `rds-db:connect` scoped to the `migrator` Postgres user on the **instance** resource only (CI schema deploys connect to the public instance endpoint).
9. An IAM role `GitHubBenchmarkIngestRole` (PR-2.1) trusted to the same OIDC provider for `vortex-data/vortex` on `develop`. Permission policy: `rds-db:connect` scoped to the `bench_ingest` Postgres user on the instance resource only. This is the dedicated least-privilege identity for the Phase-2 CI dual-write ingest path, deliberately separate from the schema-deploy `migrator` identity so the high-frequency ingest path can write data but never run DDL or migrations.
10. An IAM role `GitHubBenchmarkReadRole` trusted to the same OIDC provider for `vortex-data/vortex` on any branch and on the repository's own pull requests. Permission policy: `rds-db:connect` scoped to the `bench_ci_read` Postgres user on the instance resource only. CI uses it to read the published numbers and diff them against a run's local numbers. `bench_ci_read` (migration `011`) can only `SELECT` the six data tables, and every one of its transactions is read-only.

The `migrator` Postgres user is created by `migrations/002_iam_db_user.sql` (PR-1.3) and the `bench_ingest` user by `migrations/004_ingest_role.sql` (PR-2.1); each OIDC role's permission ARN is pre-scoped to its user. `002` is applied as the RDS master because it creates a role (it needs `CREATEROLE` and grants the `rds_iam` / schema privileges the master holds), while `003` and `004` are applied as the master because they additionally grant on master-owned objects (the ledger and the six data tables, respectively). All three run during the one-time bootstrap; the migrator-run `schema-deploy` path then records them as already-applied.

## Prerequisites

| Tool | Verification |
|---|---|
| AWS CLI v2 | `aws --version` reports `aws-cli/2.x` |
| `jq` | `jq --version` returns a version |
| Authenticated to account `245040174862` | `aws sts get-caller-identity` returns that account |
| IAM permissions on the acting principal | `rds:Create*`, `rds:Describe*`, `rds:ModifyDBInstance`, `rds:ModifyDBParameterGroup`, `rds:StartDBInstanceAutomatedBackupsReplication`, `rds:AddTagsToResource`, `sns:CreateTopic`, `sns:Subscribe`, `sns:TagResource`, `cloudwatch:PutMetricAlarm`, `cloudwatch:TagResource`, `iam:CreateRole`, `iam:CreatePolicy`, `iam:PutRolePolicy`, `iam:CreateOpenIDConnectProvider`, `iam:GetOpenIDConnectProvider`, `iam:UpdateAssumeRolePolicy`, `iam:GetRole`, `ec2:CreateSecurityGroup`, `ec2:AuthorizeSecurityGroupIngress`, `ec2:DescribeVpcs`, `ec2:DescribeSubnets`, `ec2:DescribeSecurityGroups`, `ec2:CreateTags` |

If you SSO into account `245040174862` with `PowerUserAccess` or `AdministratorAccess`, you have everything you need. Confirm with:

```sh
aws sso login --profile bench            # refresh SSO session for the bench profile
aws sts get-caller-identity --profile bench   # Account should be 245040174862
```

The `bench` profile name follows the convention established in the operator's SSO setup; if you used a different profile name, substitute it (or `export AWS_PROFILE=bench` before running `./provision.sh`).

## One-command run

```sh
cd bench/infra
ALARM_HTTPS_ENDPOINT='<incident.io CloudWatch alert source URL>' ./provision.sh
```

`ALARM_HTTPS_ENDPOINT` is optional. It carries a token, so the script reads it only from the environment and never prints it. Without it, the alarms have no subscriber until you add one.

Expected duration: 5–12 minutes (the RDS instance creation takes most of it; the script blocks on `aws rds wait db-instance-available`).

Expected end state: prints a summary block with the GitHub repo-variable values to set (instance endpoint, region, DB name, role ARNs), the backup replica region and the alarm topic.

## Idempotency

Every mutating step is gated by an existence check (`describe-*`, `get-role`, etc.) — re-running the script after a successful run is a no-op; re-running after a partial failure resumes from the first uncompleted step. Safe to interrupt at any point and re-invoke.

## Customizing

Every name / class / engine version / region is set at the top of `provision.sh` via `readonly` declarations with `${ENV:-default}` fallbacks. Override at invocation time:

```sh
TARGET_REGION=us-east-2 \
DB_INSTANCE_CLASS=db.t4g.small \
DB_ENGINE_VERSION=17.2 \
./provision.sh
```

The backup, storage and alarm settings use the same pattern: `DB_MAX_ALLOCATED_STORAGE_GB` (100), `DB_BACKUP_RETENTION_DAYS` (35), `BACKUP_REPLICA_REGION` (`us-west-2`), `BACKUP_REPLICA_RETENTION_DAYS` (14), `ALARM_TOPIC_NAME` and `EVENT_SUBSCRIPTION_NAME`. The parameter group family follows the major version in `DB_ENGINE_VERSION`, and `DB_PARAMETER_GROUP_NAME` defaults to `vortex-bench-pg<major>`.

## After provisioning — set GitHub Actions repo vars

The script prints the exact `gh variable set` commands; copy them from its output. The vars (not secrets — these are non-sensitive):

| Variable | Value | Consumed by |
|---|---|---|
| `RDS_BENCH_INSTANCE_ENDPOINT` | the public RDS **instance** hostname | CI writers — PR-1.4 bench-schema-deploy.yml; PR-2.4 ingest workflows (direct IAM) |
| `RDS_BENCH_REGION` | `us-east-1` (or override) | All AWS-CLI invocations from CI |
| `RDS_BENCH_DB_NAME` | `vortex_bench` | All Postgres connections |
| `GH_BENCH_SCHEMA_ROLE_ARN` | the schema-deploy OIDC role ARN | `.github/workflows/bench-schema-deploy.yml` |
| `GH_BENCH_INGEST_ROLE_ARN` | the ingest OIDC role ARN | PR-2.4 dual-write ingest workflows (`bench.yml` / `sql-benchmarks.yml` / `v3-commit-metadata.yml`) |
| `GH_BENCH_READ_ROLE_ARN` | the read-only OIDC role ARN | `vortex-data/vortex` CI jobs that diff against the published numbers, as Postgres user `bench_ci_read` |

The Vercel reader also connects to the public instance endpoint. It is
configured through `BENCH_DB_*` Vercel env vars (see `bench/web/README.md`),
because Vercel does not read GitHub repo variables.

No secrets are needed — IAM auth is the credential. The master password is RDS-managed; it is used only for the one-time bootstrap apply (see "Schema deploys + one-time bootstrap" below), never for steady-state CI.

## Schema deploys + one-time bootstrap

Schema migrations under `migrations/` are applied by
`.github/workflows/bench-schema-deploy.yml` (wired in PR-1.4). The workflow is
`workflow_dispatch` only: an operator triggers it manually from the GitHub
Actions UI, optionally with `dry_run: true` to report drift via
`migrate-schema.py status` without applying. That manual trigger is the deploy
gate. Per the 2026-05-29 deploy-model decision, the intended deferred change is
to ALSO trigger `apply` on push under `paths: migrations/** +
scripts/migrate-schema.py` (PR merge becomes the deploy gate) -- NOT a GitHub
Environment / manual-approval gate; execution safety comes from the per-PR
testcontainer migration test, not a human click. The runner path is included in
`paths` so a runner-only change still triggers a deploy.

Steady-state deploys connect to the public RDS **instance** endpoint
(`RDS_BENCH_INSTANCE_ENDPOINT`) as the `migrator` role using a short-lived IAM
auth token (generated client-side via `aws rds generate-db-auth-token`, signed
from the OIDC-assumed `GitHubBenchmarkSchemaRole` credentials; no password, no
IAM permission beyond `rds-db:connect`). TLS is
`verify-full` against Amazon's published RDS root CA bundle.

### One-time bootstrap (operator, as master)

CI can only IAM-auth as `migrator`, and `migrator` does not exist until
migration `002` creates it. So the FIRST apply must be run once by the RDS
master user, out-of-band. Two endpoint details matter:

- Use the public **instance** endpoint (`RDS_BENCH_INSTANCE_ENDPOINT`, from
  `aws rds describe-db-instances --db-instance-identifier vortex-bench-prod
  --query 'DBInstances[0].Endpoint.Address'`) -- the same endpoint steady-state
  CI writers use.
- The master username is the one `provision.sh` set on the instance; retrieve
  the RDS-managed master password from Secrets Manager.
- The master password works only until migration `008` runs. `008` makes the
  master a member of `migrator`, which holds `rds_iam`, and on RDS any member
  of `rds_iam` can log in only with an IAM token. After `008`, connect as the
  master with `PGPASSWORD=$(aws rds generate-db-auth-token --hostname "$PGHOST"
  --port 5432 --username postgres)`; a password login fails with `PAM
  authentication failed`.

`PGSSLMODE=verify-full` is mandatory here: the bootstrap transmits the master
password, so the RDS server certificate MUST be verified (a bare `require` only
encrypts, it does not authenticate the server -- a MITM could capture the
master password). Run these commands from the repository root (the `scripts/`
path below is relative to `bench/`, not to `bench/infra/`).
Download the CA bundle first:

```sh
curl -fsSL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
  -o /tmp/rds-global-bundle.pem
export PGHOST=<instance-endpoint>           # RDS_BENCH_INSTANCE_ENDPOINT
export PGPORT=5432
export PGDATABASE=<RDS_BENCH_DB_NAME>
export PGUSER=<master-username>
# Fetch the RDS-managed master password from Secrets Manager. Assign first, then
# export, so a failed fetch or parse is FATAL: a bare `export PGPASSWORD=$(...)`
# returns 0 even when the substitution fails (export's own exit status wins),
# which would silently continue with an empty password. `jq -er` exits non-zero
# on a missing key. Non-interactive + copy-paste-safe: no interactive `read` to
# consume pasted lines, no `stty -echo` to strand the terminal, and command
# substitution preserves any password metacharacter. provision.sh prints the
# master secret ARN; substitute it here:
master_secret=$(aws secretsmanager get-secret-value \
  --secret-id <master-secret-arn> --query SecretString --output text) || exit 1
PGPASSWORD=$(printf '%s' "$master_secret" | jq -er '.password') || exit 1
export PGPASSWORD
export PGSSLMODE=verify-full
export PGSSLROOTCERT=/tmp/rds-global-bundle.pem
uv run --no-project scripts/migrate-schema.py apply
```

This applies `001` (schema) and every migration carrying the
`-- migrate-schema: requires-superuser` marker — currently `002`/`004`/`005`
(role creation + grants) and `006`/`007` (DDL on the master-owned
`query_measurements` table). The marker in each file is authoritative; the
runner refuses to apply a marked file under a non-master role. The single source
of truth for the bootstrap-ordering contract is
[`migrations/README.md`](../../migrations/README.md) § "Bootstrap ordering —
`requires-superuser` migrations"; apply every marked migration as the master
here. `003` (a ledger grant) carries no marker. After the bootstrap, *unmarked*
migrations are applied by the `schema-deploy` workflow as `migrator` against the
public instance endpoint (`RDS_BENCH_INSTANCE_ENDPOINT`) with direct IAM; the
master password is not needed again for those.

Because the bootstrap runs as master, the schema objects and the ledger are
master-owned; `003` grants `migrator` the ledger access it needs to record and
read applied migrations. A migration that `ALTER`s or adds an index to an
existing master-owned table (rather than only `CREATE`-ing new objects) must
itself carry the `requires-superuser` marker and be master-applied here — this
is what `006`/`007` do (PR-5.1.5). `migrator`'s `CREATE` on the schema suffices
only for new-object migrations.

The per-PR testcontainer migration test (`scripts/test_migrate_schema.py`)
applies every migration as a single owning role, so it does NOT model the
master/`migrator` ownership split and cannot catch a non-additive migration that
would fail in production. Until PR-2.1 resolves the role-ownership model,
additivity must be confirmed by inspection.

## Backups

- **In us-east-1:** RDS automated backups with a 35-day window: a daily snapshot
  in the 08:08–08:38 UTC backup window, plus WAL every 5 minutes. You can
  restore to any second in the window.
- **In us-west-2:** the same snapshots and WAL, replicated with a 14-day window.
  This protects against the loss of us-east-1. It does not protect against the
  loss of the AWS account: AWS Backup can copy to another account only inside
  an AWS Organization, and this account is not in one.
- **Deletion protection** is on. Deleting the instance needs a
  `modify-db-instance --no-deletion-protection` first.

[RESTORE.md](RESTORE.md) has the restore procedure and the results of the last
restore test. Check the replica with:

```sh
aws rds describe-db-instance-automated-backups --region us-west-2 \
  --query 'DBInstanceAutomatedBackups[].[DBInstanceIdentifier,Status,RestoreWindow]'
```

## Alarms

All alarms and events go to the SNS topic `vortex-bench-alarms`, whose
subscriber is the incident.io "Amazon CloudWatch" alert source. Each alarm
sends both ALARM and OK, so incident.io resolves the alert when the metric
recovers. Each alarm needs three 5-minute periods (15 minutes) in breach.

| Alarm | Fires when | Why this threshold |
|---|---|---|
| `vortex-bench-prod-free-storage-low` | `FreeStorageSpace` minimum < 2 GiB | Storage autoscaling grows the disk at 10% free, so this fires only when autoscaling has not kept up or has reached its 100 GiB ceiling. |
| `vortex-bench-prod-cpu-high` | `CPUUtilization` average > 80% | The hourly peak was 71% in October 2026, during ingest. |
| `vortex-bench-prod-connections-high` | `DatabaseConnections` maximum > 300 | The peak was 93 in October 2026. `max_connections` is 1,702 on `db.r7g.large`. |

The RDS event subscription `vortex-bench-prod-events` forwards `failure` and
`low storage` events for `vortex-bench-prod`.

## Logs

The instance is reachable from the internet, so Postgres logs every connection
and disconnection: who connected, from which address, and whether the login
worked. The log goes to the CloudWatch log group
`/aws/rds/instance/vortex-bench-prod/postgresql` and is kept for 30 days
(`DB_LOG_RETENTION_DAYS`). To see the failed logins of the last day:

```sh
aws logs filter-log-events --log-group-name /aws/rds/instance/vortex-bench-prod/postgresql \
  --start-time $(( ($(date +%s) - 86400) * 1000 )) --filter-pattern '"authentication failed"'
```

## Account security

These are set for the whole AWS account, not only for bench, so `provision.sh`
does not manage them and a bench tear-down must not remove them. All were added
on 2026-10-28.

- **CloudTrail:** the trail `account-trail` records management events in every
  region to the private bucket `aws-cloudtrail-logs-245040174862`, with log-file
  validation.
- **GuardDuty** in us-east-1, with RDS login monitoring, so it reports unusual
  logins to `vortex-bench-prod`. S3 data-event monitoring is off, because the
  CI cache buckets are busy. Check the cost before the 30-day trial ends
  (2026-11-27).
- **IAM Access Analyzer:** `account-external-access` in us-east-1 lists the
  resources that are shared outside the account.

## Upgrades

Automatic minor version upgrades are on. RDS applies a new Postgres 16.x
release in the weekly maintenance window, Saturday 09:58–10:28 UTC. Single-AZ
means the site and ingest are down while it restarts: about 30 seconds for the
16.4 to 16.15 upgrade on 2026-10-28. An ingest job that connects during the
restart fails, because `scripts/post-ingest.py` in `vortex-data/vortex` does
not retry.

OS updates (`system-update`) are separate. A minor engine upgrade does not apply
them, and RDS applies an optional one only when someone opts in. The OS update
on 2026-10-28 restarted the instance twice and took about 3 minutes. To apply a
pending action:

```sh
aws rds describe-pending-maintenance-actions \
  --resource-identifier arn:aws:rds:us-east-1:245040174862:db:vortex-bench-prod
aws rds apply-pending-maintenance-action --opt-in-type immediate \
  --resource-identifier arn:aws:rds:us-east-1:245040174862:db:vortex-bench-prod \
  --apply-action <action>
```

Major upgrades are never automatic. Rehearse one on a restored copy first (see
[RESTORE.md](RESTORE.md)).

## Checks after provisioning

```sh
aws rds describe-db-instances \
  --db-instance-identifier vortex-bench-prod \
  --query 'DBInstances[0].[DBInstanceStatus,IAMDatabaseAuthenticationEnabled,DeletionProtection,MaxAllocatedStorage,AutoMinorVersionUpgrade,length(DBInstanceAutomatedBackupsReplications)]'
# expected: available  True  True  100  True  1

aws cloudwatch describe-alarms --alarm-name-prefix vortex-bench-prod- \
  --query 'MetricAlarms[].[AlarmName,StateValue]'
# expected: three alarms, OK once they have data
```

## Tear-down (not part of PR-1.1; documented here for completeness)

```sh
# These commands use the DEFAULT resource names. provision.sh lets you override
# every name via `${ENV:-default}` (DB_INSTANCE_IDENTIFIER, DB_SUBNET_GROUP_NAME,
# DB_SECURITY_GROUP_NAME, DB_PARAMETER_GROUP_NAME, ALARM_TOPIC_NAME,
# SCHEMA_ROLE_NAME, ...); if you set
# any override at provision time, substitute the same value in the matching
# command below.
for a in free-storage-low cpu-high connections-high; do
  aws cloudwatch delete-alarms --alarm-names "vortex-bench-prod-$a"
done
aws rds delete-event-subscription --subscription-name vortex-bench-prod-events
aws sns delete-topic --topic-arn arn:aws:sns:us-east-1:245040174862:vortex-bench-alarms
aws rds stop-db-instance-automated-backups-replication --region us-west-2 \
  --source-db-instance-arn arn:aws:rds:us-east-1:245040174862:db:vortex-bench-prod
aws rds modify-db-instance --db-instance-identifier vortex-bench-prod \
  --no-deletion-protection --apply-immediately
aws rds delete-db-instance --db-instance-identifier vortex-bench-prod \
  --final-db-snapshot-identifier vortex-bench-prod-final --delete-automated-backups
aws rds wait db-instance-deleted --db-instance-identifier vortex-bench-prod
aws rds delete-db-parameter-group --db-parameter-group-name vortex-bench-pg16
aws logs delete-log-group --log-group-name /aws/rds/instance/vortex-bench-prod/postgresql
aws iam delete-role-policy --role-name GitHubBenchmarkSchemaRole --policy-name rds-db-connect-migrator
aws iam delete-role --role-name GitHubBenchmarkSchemaRole
aws iam delete-role-policy --role-name GitHubBenchmarkIngestRole --policy-name rds-db-connect-ingest
aws iam delete-role --role-name GitHubBenchmarkIngestRole
aws iam delete-role-policy --role-name GitHubBenchmarkReadRole --policy-name rds-db-connect-ci-read
aws iam delete-role --role-name GitHubBenchmarkReadRole
aws ec2 delete-security-group --group-name vortex-bench-sg
aws rds delete-db-subnet-group --db-subnet-group-name vortex-bench-subnet-group
# OIDC provider (account-scoped): only delete if no other workflow uses it
# aws iam delete-open-id-connect-provider --open-id-connect-provider-arn arn:aws:iam::245040174862:oidc-provider/token.actions.githubusercontent.com
```

Tear-down does NOT delete the Secrets-Manager-managed master password — that's owned by RDS and is removed automatically when the instance is deleted.

## Cost

Monthly bill, on demand, from the September 2026 invoice plus estimates for what
was added in October 2026. NOTE: prod `vortex-bench-prod` was upsized to
`db.r7g.large` (16 GiB) on 2026-06-16 so the load-all `?n=all` working set stays resident in cache
(see `.big-plans/ct__bench-v4-loadall-scope.md`); the `provision.sh` bootstrap default remains
`db.t4g.micro`.

| Item | Cost |
|---|---|
| RDS `db.r7g.large` at $0.239/hr (bootstrap default `db.t4g.micro` ~$13) | ~$172 |
| 20 GiB gp3 storage | ~$2.30 |
| Backup storage in us-east-1 beyond the free 20 GiB (35-day window, ~140 GB-month in total) | ~$11 |
| Backup replica in us-west-2 (14-day window: ~66 GB-month at $0.095, plus ~120 GB a month of transfer at $0.02) | ~$9, estimate |
| CloudWatch alarms (3) | $0.30 |
| CloudWatch Logs (Postgres log, 30 days) | <$1, estimate |
| Secrets Manager (1 secret) | ~$0.40 |
| Data transfer (CI ingests + reader fetches) | <$1 |
| **Total** | **~$196/month** |

Most of the backup cost is WAL: RDS switches WAL segments at least every 5
minutes, so an idle database still writes about 225 KB/s. Check the replica's
real cost (`USW2-RDS:ChargedBackupUsage` and the `USE1-USW2-AWS-Out-Bytes`
transfer) on the first full bill after 2026-10-28.

A 1-year reserved instance for `db.r7g.large` costs $1,529 all upfront
(~$127/month) or $0.1841/hr with no upfront (~$134/month).

The RDS Proxy `vortex-bench-proxy` ($21.60/month) was deleted on 2026-10-28. It
was VPC-internal, so neither Vercel nor the GitHub runners could reach it, and
it had no client connections from 2026-05-31 to 2026-10-28.

## OIDC trust inputs

`SCHEMA_GITHUB_REPO` and `SCHEMA_GITHUB_BRANCH` default to `vortex-data/vortex.dev` and
`main`; `INGEST_GITHUB_REPO` and `INGEST_GITHUB_BRANCH` default to `vortex-data/vortex` and
`develop`. Each role trusts only that one `refs/heads/<branch>` subject with the
`sts.amazonaws.com` audience. PRs, tags, environments, other branches and the former
`vortex-data/benchmarks-website` repository are excluded. Manual schema deploys must select `main`.
The old shared `GITHUB_REPO` input is rejected to prevent an ambiguous role assignment.

The read role is the exception. `READ_GITHUB_REPO` defaults to `vortex-data/vortex`, and the role
trusts `repo:<repo>:ref:refs/heads/*` and `repo:<repo>:pull_request`, so a benchmark run on a PR
or a feature branch can read the published numbers. That is safe because its database user cannot
write. GitHub does not issue an OIDC token to a `pull_request` run from a fork, so fork PRs cannot
assume it.

Reprovisioning replaces each role's trust policy with these inputs. It does not preserve manual
subjects. Review both generated policies offline before applying infrastructure changes:

```bash
bash infra/provision.sh --print-trust schema
bash infra/provision.sh --print-trust ingest
bash infra/provision.sh --print-trust read
python3 -m unittest discover -s infra/tests -v
```

The print commands require only `jq` and make no AWS calls. They do not apply the policy.
The schema, ingest and read permission policies remain scoped to their respective database users.
