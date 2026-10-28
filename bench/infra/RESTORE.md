<!--
SPDX-License-Identifier: CC-BY-4.0
SPDX-FileCopyrightText: Copyright the Vortex contributors
-->

# Restoring the bench database

This runbook restores `vortex-bench-prod` (Postgres 16, `vortex_bench`) from a
backup. The commands use account `245040174862` and the default names from
[`provision.sh`](provision.sh).

## Backups you can restore from

| Source | Region | What you get |
|---|---|---|
| Automated backups | us-east-1 | Any second in the last 35 days. |
| Replicated automated backups | us-west-2 | Any second in the last 14 days. Use these if us-east-1 is down. |
| Manual snapshots | us-east-1 | The state at one moment. Kept until someone deletes them. |
| `pg_dump` | an operator's computer | A logical copy. Use it only if every AWS copy is lost. |

A restore always makes a **new** instance. It never writes over
`vortex-bench-prod`.

## 1. Pick the restore point

Pick a time (UTC) before the bad change. For a lost instance or a lost region,
use the latest restorable time.

```sh
aws rds describe-db-instance-automated-backups --region us-east-1 \
  --db-instance-identifier vortex-bench-prod \
  --query 'DBInstanceAutomatedBackups[].[Status,RestoreWindow]'
```

## 2. Restore to a new instance

Set the region and the name of the new instance. The commands in steps 2, 3 and
6 use them.

```sh
REGION=us-east-1               # us-west-2 if us-east-1 is down
TARGET=vortex-bench-restore    # vortex-bench-prod for a restore in us-west-2
```

From us-east-1:

```sh
aws rds restore-db-instance-to-point-in-time --region "$REGION" \
  --source-db-instance-identifier vortex-bench-prod \
  --target-db-instance-identifier "$TARGET" \
  --restore-time 2026-10-28T16:00:00Z \
  --db-instance-class db.r7g.large \
  --db-subnet-group-name vortex-bench-subnet-group \
  --db-parameter-group-name vortex-bench-pg16 \
  --vpc-security-group-ids <security-group-id> \
  --publicly-accessible --no-multi-az \
  --enable-iam-database-authentication \
  --tags Key=Project,Value=vortex-benchmarks
aws rds wait db-instance-available --region "$REGION" \
  --db-instance-identifier "$TARGET"
```

Use `--use-latest-restorable-time` instead of `--restore-time` for the newest
data. For a test, use a temporary security group that allows only your IP, and
add `--backup-retention-period 0` so the copy makes no backups of its own. For a
replacement, use `vortex-bench-sg`.

From us-west-2, if us-east-1 is down:

1. Find the replicated backup:

   ```sh
   aws rds describe-db-instance-automated-backups --region us-west-2 \
     --query 'DBInstanceAutomatedBackups[].[DBInstanceAutomatedBackupsArn,RestoreWindow]'
   ```

2. us-west-2 has none of the network or parameter resources. Make them in its
   default VPC. Do not run `provision.sh` for this: it would also create an
   empty `vortex-bench-prod` there.

   ```sh
   R=us-west-2
   VPC=$(aws ec2 describe-vpcs --region $R --filters Name=is-default,Values=true \
     --query 'Vpcs[0].VpcId' --output text)
   SUBNETS=$(aws ec2 describe-subnets --region $R --filters Name=vpc-id,Values=$VPC \
     --query 'Subnets[].SubnetId' --output text)
   aws rds create-db-subnet-group --region $R --db-subnet-group-name vortex-bench-subnet-group \
     --db-subnet-group-description "vortex-benchmarks RDS subnet group (default VPC)" \
     --subnet-ids $SUBNETS
   SG=$(aws ec2 create-security-group --region $R --group-name vortex-bench-sg \
     --description "vortex-benchmarks Postgres ingress (IAM-auth gated)" --vpc-id $VPC \
     --query GroupId --output text)
   aws ec2 authorize-security-group-ingress --region $R --group-id $SG \
     --protocol tcp --port 5432 --cidr 0.0.0.0/0
   aws rds create-db-parameter-group --region $R --db-parameter-group-name vortex-bench-pg16 \
     --db-parameter-group-family postgres16 --description "vortex-benchmarks Postgres 16 parameters"
   aws rds modify-db-parameter-group --region $R --db-parameter-group-name vortex-bench-pg16 \
     --parameters "ParameterName=work_mem,ParameterValue=32768,ApplyMethod=immediate"
   ```

3. Set `REGION=us-west-2` and `TARGET=vortex-bench-prod`. Restore with
   `--vpc-security-group-ids $SG` and
   `--source-db-instance-automated-backups-arn <arn>` in place of
   `--source-db-instance-identifier`.

A restore takes about 10 minutes for this database. After that, the first read
of each block is slow, because RDS loads it from S3 on first access: a full
count of every table took 3 minutes on the copy and 16 seconds on prod. See
[Last restore test](#last-restore-test).

The restore does not accept `--manage-master-user-password` for Postgres. You do
not need it: see step 3.

## 3. Connect

The master user `postgres` can log in only with an IAM auth token. Migration
`008` made it a member of `migrator`, which holds `rds_iam`, and that is part of
the restored data. Any AWS principal with `rds-db:connect` on the new instance
can make a token; an administrator can.

```sh
curl -fsSL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
  -o /tmp/rds-global-bundle.pem
export PGHOST=$(aws rds describe-db-instances --region "$REGION" \
  --db-instance-identifier "$TARGET" --query 'DBInstances[0].Endpoint.Address' --output text)
export PGPORT=5432 PGDATABASE=vortex_bench PGUSER=postgres
export PGSSLMODE=verify-full PGSSLROOTCERT=/tmp/rds-global-bundle.pem
PGPASSWORD=$(aws rds generate-db-auth-token --region "$REGION" --hostname "$PGHOST" \
  --port 5432 --username postgres) || exit 1
export PGPASSWORD
psql -c 'SELECT 1'
```

The token is signed for `$REGION` and is valid for 15 minutes. Make a new one
when a new connection fails.

## 4. Check the data

Run these in a read-only session:

```sql
SET default_transaction_read_only = on;
SELECT current_setting('server_version');
SELECT string_agg(filename, ' ' ORDER BY filename) FROM public._applied_migrations;
SELECT 'commits' AS tbl, count(*), max(timestamp)::text FROM commits
UNION ALL SELECT 'query_measurements', count(*), max(measurement_id)::text FROM query_measurements
UNION ALL SELECT 'compression_times', count(*), max(measurement_id)::text FROM compression_times
UNION ALL SELECT 'compression_sizes', count(*), max(measurement_id)::text FROM compression_sizes
UNION ALL SELECT 'random_access_times', count(*), max(measurement_id)::text FROM random_access_times
UNION ALL SELECT 'vector_search_runs', count(*), max(measurement_id)::text FROM vector_search_runs;
```

- The ledger must list every file in [`../migrations/`](../migrations/).
- The newest `commits.timestamp` must be close to the restore point.
- The row counts must not be lower than in the last known good state.

## 5. Use the restored data

**To recover some rows,** copy them from the restored instance to
`vortex-bench-prod`, for example with `pg_dump --data-only -t <table>` and
`psql`, then delete the restored instance.

**To replace the instance,** keep the name `vortex-bench-prod`. The endpoint
hostname comes from the name, so Vercel and the GitHub variables need no change.

1. Stop writes: let running ingest jobs in `vortex-data/vortex` finish, and do
   not run a schema deploy.
2. Rename the old instance, then the new one. Each rename takes a few minutes,
   and the site is down between them.

   ```sh
   aws rds modify-db-instance --db-instance-identifier vortex-bench-prod \
     --new-db-instance-identifier vortex-bench-old --apply-immediately
   aws rds wait db-instance-available --db-instance-identifier vortex-bench-old
   aws rds modify-db-instance --db-instance-identifier "$TARGET" \
     --new-db-instance-identifier vortex-bench-prod --apply-immediately
   aws rds wait db-instance-available --db-instance-identifier vortex-bench-prod
   ```

3. The new instance has a new resource ID (`DbiResourceId`). The permission
   policies of `GitHubBenchmarkSchemaRole` (`rds-db-connect-migrator`) and
   `GitHubBenchmarkIngestRole` (`rds-db-connect-ingest`) name the old one, so
   CI cannot log in until you update them. Run `provision.sh`: it rewrites
   both permission policies with the new resource ID and sets deletion
   protection, storage autoscaling, the 35-day backup window, automatic minor
   upgrades and the us-west-2 backup replication on the new instance. It also
   rewrites the trust policies, with the same content.
4. Check `https://bench.vortex.dev` and the next ingest run.
5. Stop the old instance's backup replication, turn off its deletion
   protection and delete it, with a final snapshot.

A restore from us-west-2 has a different endpoint. Set the
`RDS_BENCH_INSTANCE_ENDPOINT` and `RDS_BENCH_REGION` GitHub variables and
`BENCH_DB_HOST` in Vercel to match. Then run `provision.sh` with
`TARGET_REGION=us-west-2 BACKUP_REPLICA_REGION=us-east-1` (or another region):
the backup replica must be in a different region from the instance.

## 6. Clean up a test restore

```sh
aws rds delete-db-instance --region "$REGION" --db-instance-identifier "$TARGET" \
  --skip-final-snapshot --delete-automated-backups
aws rds wait db-instance-deleted --region "$REGION" --db-instance-identifier "$TARGET"
aws ec2 delete-security-group --region "$REGION" --group-id <temporary-security-group-id>
```

## Restore from a `pg_dump`

A dump made with `pg_dump -Fd` and `pg_dumpall --globals-only
--no-role-passwords` restores to a new, empty Postgres 16 instance:

1. Make an empty instance with the `create-db-instance` flags in
   `provision.sh` and a new name. Do not run `provision.sh` with a different
   `DB_INSTANCE_IDENTIFIER`: it would point both CI roles at the new instance.
   Do not run the migrations: the dump has the schema.
2. As the master, with the password from Secrets Manager, run only the lines of
   `globals.sql` for the bench roles: the `CREATE ROLE` and `ALTER ROLE` lines
   for `migrator`, `bench_ingest` and `bench_read`, and the grants
   `rds_iam TO migrator`, `rds_iam TO bench_ingest` and `migrator TO postgres`.
   The other roles belong to RDS and already exist. Set the `bench_read`
   password again, because the dump holds no passwords. After the
   `migrator TO postgres` grant, the master logs in only with an IAM token (see
   step 3).
3. `pg_restore -d vortex_bench -j 4 <dump>/vortex_bench.dir` as the master.
4. Check the data as in step 4.

## Last restore test

2026-10-28, before the upgrade of prod from 16.4 to 16.15.

- **Restore:** to the latest restorable time at 17:33:50 UTC, on
  `db.r7g.large`. Available 10 minutes later. The newest commit in the copy
  was from 17:21:20 UTC.
- **Ledger:** `001`–`010`, the same as `bench/migrations/`.
- **Rows:** every table was between a `pg_dump` taken at 17:18 UTC and prod at
  17:47 UTC, as expected while ingest runs:

  | Table | `pg_dump` 17:18 | Restored copy | Prod 17:47 |
  |---|---|---|---|
  | `commits` | 5,891 | 5,892 | 5,892 |
  | `query_measurements` | 7,455,730 | 7,457,400 | 7,460,273 |
  | `compression_times` | 380,340 | 380,340 | 380,580 |
  | `compression_sizes` | 169,908 | 169,908 | 170,028 |
  | `random_access_times` | 111,205 | 111,385 | 111,529 |
  | `vector_search_runs` | 0 | 0 | 0 |

- **Upgrade rehearsal on the copy:** 16.4 to 16.15. A probe that connected
  every 2 seconds failed for 32 seconds. RDS reported the instance available 3
  minutes after the request. The ledger and row counts did not change.
- **Prod upgrade, the same day:** 33 seconds without connections (17:59:52 to
  18:00:27 UTC); `/api/health` returned 503 for that time. The engine upgrade
  did not apply the pending OS update, so that was a separate restart:
  it shut the instance down twice, and connections failed for about 3 minutes
  (18:12:20 to 18:15:24 UTC). Four ingest jobs in `vortex-data/vortex` connected
  during the two outages and failed, because `scripts/post-ingest.py` does not
  retry.
