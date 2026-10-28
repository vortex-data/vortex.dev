#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: Copyright the Vortex contributors
#
# One-time bootstrap of the bench AWS infrastructure: RDS Postgres, its
# backups and alarms, and the GitHub Actions OIDC roles for schema deploys
# and ingest. Idempotent: safe to re-run; each step checks for an existing
# resource and skips creation if found. See infra/README.md for the
# full operator runbook and infra/RESTORE.md for restores.
#
# Prerequisites (verified at start of script):
#   1. AWS CLI v2 installed and authenticated (e.g. `aws sso login`).
#   2. `jq` installed (used to parse aws-cli JSON output).
#   3. The acting principal has permission to create RDS instances, DB
#      parameter groups, IAM roles + policies, EC2 security groups, DB
#      subnet groups, SNS topics and CloudWatch alarms in the target
#      account / region.
#
# What this script provisions, in order:
#   1. Verifies AWS identity + region (account `245040174862` in
#      `us-east-1` by default; both overridable via env).
#   2. Identifies the default VPC and its subnets.
#   3. Creates a DB subnet group `vortex-bench-subnet-group` covering
#      every subnet in the default VPC.
#   4. Creates a security group `vortex-bench-sg` allowing inbound
#      TCP 5432 from anywhere (`0.0.0.0/0`) - IAM auth is the gate, not
#      network ACLs.
#   5. Creates the DB parameter group `vortex-bench-pg16` (`work_mem` 32 MiB)
#      and the RDS Postgres instance `vortex-bench-prod`:
#      db.t4g.micro, postgres 16, IAM auth enabled, RDS-managed master
#      password (auto-rotated, stored in Secrets Manager), deletion
#      protection, storage autoscaling to 100 GiB, automatic minor upgrades.
#   6. Waits for the instance to reach `available`, then applies the same
#      protection, storage, backup and upgrade settings to an instance that
#      already existed.
#   7. Replicates the automated backups (snapshots and WAL) to `us-west-2`,
#      for 14 days of point-in-time recovery there.
#   8. Creates the SNS topic `vortex-bench-alarms`, three CloudWatch alarms
#      (free storage, CPU, connections) and an RDS event subscription
#      (failure, low storage). Subscribes `ALARM_HTTPS_ENDPOINT` (the
#      incident.io CloudWatch alert source) when it is set.
#   9. Creates two GitHub Actions OIDC IAM roles trusted to
#      `token.actions.githubusercontent.com`, each scoped to one branch of its
#      repository and one instance dbuser:
#        - `GitHubBenchmarkSchemaRole`: `rds-db:connect` on the `migrator`
#          Postgres user (schema deploys; migration 002 in PR-1.3).
#        - `GitHubBenchmarkIngestRole`: `rds-db:connect` on the `bench_ingest`
#          Postgres user (Phase-2 CI dual-write ingest; migration 004 in PR-2.1).
#  10. Prints a summary: the GitHub Actions vars to set (instance endpoint,
#      region, DB name, both role ARNs).
#
# Re-run safety: every aws-cli mutation goes through `ensure_*`
# functions that check for an existing resource first. A partially
# failed run can be resumed by re-invoking the script.

set -euo pipefail

# -----------------------------------------------------------------------------
# Configuration. Override via environment as needed.
# -----------------------------------------------------------------------------

readonly TARGET_ACCOUNT="${TARGET_ACCOUNT:-245040174862}"
readonly TARGET_REGION="${TARGET_REGION:-us-east-1}"
readonly DB_INSTANCE_IDENTIFIER="${DB_INSTANCE_IDENTIFIER:-vortex-bench-prod}"
readonly DB_SUBNET_GROUP_NAME="${DB_SUBNET_GROUP_NAME:-vortex-bench-subnet-group}"
readonly DB_SECURITY_GROUP_NAME="${DB_SECURITY_GROUP_NAME:-vortex-bench-sg}"
readonly DB_NAME="${DB_NAME:-vortex_bench}"
# Bootstrap default only. Prod `vortex-bench-prod` was later upsized to db.r7g.large (16 GiB) via
# `aws rds modify-db-instance` (2026-06-16) so the load-all `?n=all` working set stays cache-resident;
# this default applies only to a fresh provision. See `.big-plans/ct__bench-v4-loadall-scope.md`.
readonly DB_INSTANCE_CLASS="${DB_INSTANCE_CLASS:-db.t4g.micro}"
readonly DB_ENGINE_VERSION="${DB_ENGINE_VERSION:-16.15}"
readonly DB_PARAMETER_GROUP_NAME="${DB_PARAMETER_GROUP_NAME:-vortex-bench-pg16}"
readonly DB_ALLOCATED_STORAGE_GB="${DB_ALLOCATED_STORAGE_GB:-20}"
# Storage autoscaling ceiling. RDS grows the disk when free space falls below 10%.
readonly DB_MAX_ALLOCATED_STORAGE_GB="${DB_MAX_ALLOCATED_STORAGE_GB:-100}"
readonly DB_BACKUP_RETENTION_DAYS="${DB_BACKUP_RETENTION_DAYS:-35}"
readonly DB_MASTER_USERNAME="${DB_MASTER_USERNAME:-postgres}"
# Off-region copy of the automated backups (snapshots and WAL), restorable to
# any point in the last BACKUP_REPLICA_RETENTION_DAYS days.
readonly BACKUP_REPLICA_REGION="${BACKUP_REPLICA_REGION:-us-west-2}"
readonly BACKUP_REPLICA_RETENTION_DAYS="${BACKUP_REPLICA_RETENTION_DAYS:-14}"
readonly ALARM_TOPIC_NAME="${ALARM_TOPIC_NAME:-vortex-bench-alarms}"
readonly EVENT_SUBSCRIPTION_NAME="${EVENT_SUBSCRIPTION_NAME:-vortex-bench-prod-events}"
# The incident.io "Amazon CloudWatch" alert source URL. It carries a token, so
# it is read from the environment only and never printed. Unset: no subscription.
readonly ALARM_HTTPS_ENDPOINT="${ALARM_HTTPS_ENDPOINT:-}"
readonly SCHEMA_ROLE_NAME="${SCHEMA_ROLE_NAME:-GitHubBenchmarkSchemaRole}"
readonly INGEST_ROLE_NAME="${INGEST_ROLE_NAME:-GitHubBenchmarkIngestRole}"
readonly SCHEMA_GITHUB_REPO="${SCHEMA_GITHUB_REPO:-vortex-data/vortex.dev}"
readonly SCHEMA_GITHUB_BRANCH="${SCHEMA_GITHUB_BRANCH:-main}"
readonly INGEST_GITHUB_REPO="${INGEST_GITHUB_REPO:-vortex-data/vortex}"
readonly INGEST_GITHUB_BRANCH="${INGEST_GITHUB_BRANCH:-develop}"
# Postgres role created by migrations/002 in PR-1.3; the OIDC role's
# rds-db:connect permission is scoped to this user. NOT overridable (unlike the
# other names above): the role name is hardcoded in migrations/002
# (`CREATE ROLE migrator`, static SQL) and the schema-deploy workflow connects
# as `migrator`, so an env override here would scope the IAM grant to a user the
# migration never creates and silently break deploy auth.
readonly PG_MIGRATOR_ROLE="migrator"
# Postgres role created by migrations/004 in PR-2.1; the ingest OIDC role's
# rds-db:connect permission is scoped to this user. NOT overridable, same
# rationale as PG_MIGRATOR_ROLE: the role name is hardcoded in migrations/004
# (`CREATE ROLE bench_ingest`, static SQL) and the dual-write CI workflows
# authenticate as `bench_ingest`, so an env override would scope the IAM grant to
# a user the migration never creates and silently break ingest auth.
readonly PG_INGEST_ROLE="bench_ingest"

readonly TAG_KEY_PROJECT="Project"
readonly TAG_VAL_PROJECT="vortex-benchmarks"
readonly TAG_KEY_OWNER="ManagedBy"
readonly TAG_VAL_OWNER="bench/infra/provision.sh"

# -----------------------------------------------------------------------------
# Logging.
# -----------------------------------------------------------------------------

log()  { printf '[%s] %s\n'  "$(date -u +%H:%M:%SZ)" "$*" >&2; }
warn() { printf '[%s] WARN: %s\n' "$(date -u +%H:%M:%SZ)" "$*" >&2; }
die()  { printf '[%s] FATAL: %s\n' "$(date -u +%H:%M:%SZ)" "$*" >&2; exit 1; }

# -----------------------------------------------------------------------------
# Step 0: Verify prerequisites.
# -----------------------------------------------------------------------------

verify_prereqs() {
    log "Step 0: Verifying prerequisites."

    command -v aws >/dev/null || die "aws CLI not found. Install via 'brew install awscli'."
    command -v jq  >/dev/null || die "jq not found. Install via 'brew install jq'."

    local aws_version_raw aws_major
    aws_version_raw=$(aws --version 2>&1)
    aws_major=$(printf '%s\n' "$aws_version_raw" | sed -E -n 's|.*aws-cli/([0-9]+).*|\1|p')
    [[ "$aws_major" =~ ^[0-9]+$ ]] \
        || die "Could not parse aws CLI version from: ${aws_version_raw}"
    [ "$aws_major" -ge 2 ] || die "aws CLI v2 required; found v${aws_major}."

    local caller_account caller_err
    # PID-suffixed path is portable across GNU coreutils (Amazon Linux,
    # CloudShell) and BSD (macOS) mktemp variants. GNU mktemp -t requires
    # X's in the template; BSD mktemp -t takes a plain prefix. Sidestep
    # both by constructing the path directly.
    caller_err="${TMPDIR:-/tmp}/provision-caller-err.$$"
    # shellcheck disable=SC2064
    trap "rm -f '${caller_err}'" EXIT
    caller_account=$(aws sts get-caller-identity --query 'Account' --output text 2>"$caller_err") \
        || die "aws sts get-caller-identity failed: $(cat "$caller_err")"
    [ "$caller_account" = "$TARGET_ACCOUNT" ] \
        || die "Authenticated to account ${caller_account}, but TARGET_ACCOUNT=${TARGET_ACCOUNT}."

    export AWS_REGION="$TARGET_REGION"
    export AWS_DEFAULT_REGION="$TARGET_REGION"
    log "  ok: account ${TARGET_ACCOUNT}, region ${TARGET_REGION}."
}

# -----------------------------------------------------------------------------
# Step 1: Identify the default VPC and its subnets.
# -----------------------------------------------------------------------------

discover_default_vpc() {
    log "Step 1: Discovering default VPC and subnets."

    DEFAULT_VPC_ID=$(aws ec2 describe-vpcs \
        --filters Name=is-default,Values=true \
        --query 'Vpcs[0].VpcId' --output text)
    [ "$DEFAULT_VPC_ID" != "None" ] || die "No default VPC found in ${TARGET_REGION}."
    log "  default VPC: ${DEFAULT_VPC_ID}"

    # bash-3.2-compatible read loop (macOS ships bash 3.2; `mapfile` is bash 4+).
    DEFAULT_SUBNETS=()
    while IFS= read -r _subnet; do
        DEFAULT_SUBNETS+=("$_subnet")
    done < <(aws ec2 describe-subnets \
        --filters "Name=vpc-id,Values=${DEFAULT_VPC_ID}" \
        --query 'Subnets[].SubnetId' --output text | tr '\t' '\n')
    [ "${#DEFAULT_SUBNETS[@]}" -ge 2 ] \
        || die "Found ${#DEFAULT_SUBNETS[@]} subnets in default VPC; need at least 2 for RDS subnet group."
    log "  subnets: ${DEFAULT_SUBNETS[*]}"
}

# -----------------------------------------------------------------------------
# Step 2: DB subnet group.
# -----------------------------------------------------------------------------

ensure_db_subnet_group() {
    log "Step 2: DB subnet group ${DB_SUBNET_GROUP_NAME}."

    if aws rds describe-db-subnet-groups --db-subnet-group-name "$DB_SUBNET_GROUP_NAME" \
            >/dev/null 2>&1; then
        log "  exists; skipping."
        return 0
    fi

    aws rds create-db-subnet-group \
        --db-subnet-group-name "$DB_SUBNET_GROUP_NAME" \
        --db-subnet-group-description "vortex-benchmarks RDS subnet group (default VPC)" \
        --subnet-ids "${DEFAULT_SUBNETS[@]}" \
        --tags "Key=${TAG_KEY_PROJECT},Value=${TAG_VAL_PROJECT}" \
               "Key=${TAG_KEY_OWNER},Value=${TAG_VAL_OWNER}" \
        >/dev/null
    log "  created."
}

# -----------------------------------------------------------------------------
# Step 3: Security group (open 5432; IAM auth is the gate).
# -----------------------------------------------------------------------------

ensure_security_group() {
    log "Step 3: Security group ${DB_SECURITY_GROUP_NAME}."

    DB_SG_ID=$(aws ec2 describe-security-groups \
        --filters "Name=group-name,Values=${DB_SECURITY_GROUP_NAME}" \
                  "Name=vpc-id,Values=${DEFAULT_VPC_ID}" \
        --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || echo "None")

    if [ "$DB_SG_ID" != "None" ]; then
        log "  exists: ${DB_SG_ID}; skipping creation."
    else
        DB_SG_ID=$(aws ec2 create-security-group \
            --group-name "$DB_SECURITY_GROUP_NAME" \
            --description "vortex-benchmarks Postgres ingress (IAM-auth gated)" \
            --vpc-id "$DEFAULT_VPC_ID" \
            --query 'GroupId' --output text)
        log "  created: ${DB_SG_ID}"

        aws ec2 create-tags --resources "$DB_SG_ID" \
            --tags "Key=${TAG_KEY_PROJECT},Value=${TAG_VAL_PROJECT}" \
                   "Key=${TAG_KEY_OWNER},Value=${TAG_VAL_OWNER}"
    fi

    # Authorize inbound 5432 from anywhere if not already.
    local existing_rule
    existing_rule=$(aws ec2 describe-security-groups --group-ids "$DB_SG_ID" \
        --query 'SecurityGroups[0].IpPermissions[?FromPort==`5432`]' --output json)
    if [ "$(echo "$existing_rule" | jq 'length')" -eq 0 ]; then
        aws ec2 authorize-security-group-ingress \
            --group-id "$DB_SG_ID" \
            --protocol tcp --port 5432 --cidr 0.0.0.0/0 \
            >/dev/null
        log "  inbound 5432 from 0.0.0.0/0 authorized."
    else
        log "  inbound 5432 already authorized; skipping."
    fi
}

# -----------------------------------------------------------------------------
# Step 4: DB parameter group and RDS Postgres instance.
# -----------------------------------------------------------------------------

ensure_parameter_group() {
    log "Step 4a: DB parameter group ${DB_PARAMETER_GROUP_NAME}."

    if aws rds describe-db-parameter-groups --db-parameter-group-name "$DB_PARAMETER_GROUP_NAME" \
            >/dev/null 2>&1; then
        log "  exists; re-applying parameters."
    else
        aws rds create-db-parameter-group \
            --db-parameter-group-name "$DB_PARAMETER_GROUP_NAME" \
            --db-parameter-group-family postgres16 \
            --description "vortex-benchmarks Postgres 16 parameters" \
            --tags "Key=${TAG_KEY_PROJECT},Value=${TAG_VAL_PROJECT}" \
                   "Key=${TAG_KEY_OWNER},Value=${TAG_VAL_OWNER}" \
            >/dev/null
        log "  created."
    fi

    # work_mem is in KiB. 32 MiB lets the load-all reads sort in memory.
    aws rds modify-db-parameter-group \
        --db-parameter-group-name "$DB_PARAMETER_GROUP_NAME" \
        --parameters "ParameterName=work_mem,ParameterValue=32768,ApplyMethod=immediate" \
        >/dev/null
    log "  work_mem=32768 applied."
}

ensure_rds_instance() {
    log "Step 4b: RDS instance ${DB_INSTANCE_IDENTIFIER}."

    if aws rds describe-db-instances --db-instance-identifier "$DB_INSTANCE_IDENTIFIER" \
            >/dev/null 2>&1; then
        log "  exists; skipping creation."
    else
        aws rds create-db-instance \
            --db-instance-identifier "$DB_INSTANCE_IDENTIFIER" \
            --db-instance-class "$DB_INSTANCE_CLASS" \
            --engine postgres \
            --engine-version "$DB_ENGINE_VERSION" \
            --allocated-storage "$DB_ALLOCATED_STORAGE_GB" \
            --max-allocated-storage "$DB_MAX_ALLOCATED_STORAGE_GB" \
            --storage-type gp3 \
            --master-username "$DB_MASTER_USERNAME" \
            --manage-master-user-password \
            --db-name "$DB_NAME" \
            --db-parameter-group-name "$DB_PARAMETER_GROUP_NAME" \
            --db-subnet-group-name "$DB_SUBNET_GROUP_NAME" \
            --vpc-security-group-ids "$DB_SG_ID" \
            --enable-iam-database-authentication \
            --backup-retention-period "$DB_BACKUP_RETENTION_DAYS" \
            --publicly-accessible \
            --no-multi-az \
            --auto-minor-version-upgrade \
            --deletion-protection \
            --tags "Key=${TAG_KEY_PROJECT},Value=${TAG_VAL_PROJECT}" \
                   "Key=${TAG_KEY_OWNER},Value=${TAG_VAL_OWNER}" \
            >/dev/null
        log "  creation initiated; waiting for instance to become available (typ. 5-10 min)."
    fi

    aws rds wait db-instance-available --db-instance-identifier "$DB_INSTANCE_IDENTIFIER"
    log "  available."

    # Re-assert the settings on an instance that existed before they were added
    # here. All four take effect at once without a restart, and the call omits
    # --apply-immediately so it cannot pull a queued engine upgrade forward.
    aws rds modify-db-instance \
        --db-instance-identifier "$DB_INSTANCE_IDENTIFIER" \
        --deletion-protection \
        --max-allocated-storage "$DB_MAX_ALLOCATED_STORAGE_GB" \
        --backup-retention-period "$DB_BACKUP_RETENTION_DAYS" \
        --auto-minor-version-upgrade \
        >/dev/null
    log "  deletion protection, storage autoscaling (${DB_MAX_ALLOCATED_STORAGE_GB} GiB), ${DB_BACKUP_RETENTION_DAYS}-day backups and automatic minor upgrades set."

    DB_ENDPOINT=$(aws rds describe-db-instances \
        --db-instance-identifier "$DB_INSTANCE_IDENTIFIER" \
        --query 'DBInstances[0].Endpoint.Address' --output text)
    DB_INSTANCE_ARN=$(aws rds describe-db-instances \
        --db-instance-identifier "$DB_INSTANCE_IDENTIFIER" \
        --query 'DBInstances[0].DBInstanceArn' --output text)
    DB_RESOURCE_ID=$(aws rds describe-db-instances \
        --db-instance-identifier "$DB_INSTANCE_IDENTIFIER" \
        --query 'DBInstances[0].DbiResourceId' --output text)
    DB_MASTER_SECRET_ARN=$(aws rds describe-db-instances \
        --db-instance-identifier "$DB_INSTANCE_IDENTIFIER" \
        --query 'DBInstances[0].MasterUserSecret.SecretArn' --output text)
    log "  endpoint: ${DB_ENDPOINT}"
    log "  resource-id: ${DB_RESOURCE_ID}"
}

# -----------------------------------------------------------------------------
# Step 5: Off-region backups.
# -----------------------------------------------------------------------------

ensure_backup_replication() {
    log "Step 5: Automated-backup replication to ${BACKUP_REPLICA_REGION}."

    # An unencrypted source needs no KMS key. If the instance is ever encrypted,
    # pass --kms-key-id with a key in the destination region.
    local replications
    replications=$(aws rds describe-db-instances \
        --db-instance-identifier "$DB_INSTANCE_IDENTIFIER" \
        --query 'length(DBInstances[0].DBInstanceAutomatedBackupsReplications || `[]`)' --output text)
    if [ "$replications" -gt 0 ]; then
        log "  already replicating; skipping."
        return 0
    fi

    aws rds start-db-instance-automated-backups-replication \
        --region "$BACKUP_REPLICA_REGION" \
        --source-db-instance-arn "$DB_INSTANCE_ARN" \
        --backup-retention-period "$BACKUP_REPLICA_RETENTION_DAYS" \
        >/dev/null
    log "  started (${BACKUP_REPLICA_RETENTION_DAYS}-day retention). The first full copy takes a while."
}

# -----------------------------------------------------------------------------
# Step 6: Alarms.
# -----------------------------------------------------------------------------

put_rds_alarm() {
    # $1 name suffix, $2 metric, $3 statistic, $4 comparison, $5 threshold, $6 description
    aws cloudwatch put-metric-alarm \
        --alarm-name "${DB_INSTANCE_IDENTIFIER}-$1" \
        --alarm-description "$6 Runbook: bench/infra/README.md in vortex-data/vortex.dev." \
        --namespace AWS/RDS --metric-name "$2" \
        --dimensions "Name=DBInstanceIdentifier,Value=${DB_INSTANCE_IDENTIFIER}" \
        --statistic "$3" --comparison-operator "$4" --threshold "$5" \
        --period 300 --evaluation-periods 3 --datapoints-to-alarm 3 \
        --treat-missing-data missing \
        --alarm-actions "$ALARM_TOPIC_ARN" --ok-actions "$ALARM_TOPIC_ARN" \
        --tags "Key=${TAG_KEY_PROJECT},Value=${TAG_VAL_PROJECT}" \
               "Key=${TAG_KEY_OWNER},Value=${TAG_VAL_OWNER}"
}

ensure_alarms() {
    log "Step 6: Alarms to SNS topic ${ALARM_TOPIC_NAME}."

    # create-topic returns the existing topic when the name and tags match.
    ALARM_TOPIC_ARN=$(aws sns create-topic --name "$ALARM_TOPIC_NAME" \
        --tags "Key=${TAG_KEY_PROJECT},Value=${TAG_VAL_PROJECT}" \
               "Key=${TAG_KEY_OWNER},Value=${TAG_VAL_OWNER}" \
        --query TopicArn --output text)
    log "  topic: ${ALARM_TOPIC_ARN}"

    if [ -n "$ALARM_HTTPS_ENDPOINT" ]; then
        # subscribe is idempotent for an endpoint already on the topic.
        aws sns subscribe --topic-arn "$ALARM_TOPIC_ARN" --protocol https \
            --notification-endpoint "$ALARM_HTTPS_ENDPOINT" >/dev/null
        log "  ALARM_HTTPS_ENDPOINT subscribed."
    else
        warn "ALARM_HTTPS_ENDPOINT is unset; alarms reach no one until the topic has a subscriber."
    fi

    # Every alarm needs 15 minutes (3 x 5 min) in breach. Storage autoscaling
    # grows the disk at 10% free, so the storage alarm fires only when
    # autoscaling has not kept up or is at DB_MAX_ALLOCATED_STORAGE_GB. Normal
    # peak connections are under 100 of about 1,700.
    put_rds_alarm free-storage-low FreeStorageSpace Minimum LessThanThreshold 2147483648 \
        "${DB_INSTANCE_IDENTIFIER} has had under 2 GiB free storage for 15 minutes."
    put_rds_alarm cpu-high CPUUtilization Average GreaterThanThreshold 80 \
        "${DB_INSTANCE_IDENTIFIER} CPU has averaged over 80% for 15 minutes."
    put_rds_alarm connections-high DatabaseConnections Maximum GreaterThanThreshold 300 \
        "${DB_INSTANCE_IDENTIFIER} has had over 300 connections for 15 minutes."
    log "  CloudWatch alarms applied (free storage, CPU, connections)."

    if aws rds describe-event-subscriptions --subscription-name "$EVENT_SUBSCRIPTION_NAME" \
            >/dev/null 2>&1; then
        log "  RDS event subscription exists; skipping."
    else
        aws rds create-event-subscription \
            --subscription-name "$EVENT_SUBSCRIPTION_NAME" \
            --sns-topic-arn "$ALARM_TOPIC_ARN" \
            --source-type db-instance \
            --source-ids "$DB_INSTANCE_IDENTIFIER" \
            --event-categories failure "low storage" \
            --enabled \
            --tags "Key=${TAG_KEY_PROJECT},Value=${TAG_VAL_PROJECT}" \
                   "Key=${TAG_KEY_OWNER},Value=${TAG_VAL_OWNER}" \
            >/dev/null
        log "  RDS event subscription created (failure, low storage)."
    fi
}

# -----------------------------------------------------------------------------
# Step 7: GitHub Actions OIDC IAM roles for schema deploys and ingest.
# -----------------------------------------------------------------------------

ensure_oidc_provider() {
    # The GitHub OIDC provider is account-scoped; one provider per account.
    local provider_url="token.actions.githubusercontent.com"
    local provider_arn="arn:aws:iam::${TARGET_ACCOUNT}:oidc-provider/${provider_url}"

    if aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$provider_arn" \
            >/dev/null 2>&1; then
        log "  OIDC provider exists; skipping creation."
    else
        aws iam create-open-id-connect-provider \
            --url "https://${provider_url}" \
            --client-id-list "sts.amazonaws.com" \
            --thumbprint-list "6938fd4d98bab03faadb97b34396831e3780aea1" \
            >/dev/null
        log "  OIDC provider created."
    fi
    OIDC_PROVIDER_ARN="$provider_arn"
}

# Exact subjects deliberately exclude PRs, tags, and retired migration branches.
# Reprovisioning replaces trust with this declared policy, including on existing roles.
github_trust_policy() {
    jq -n --arg account "$TARGET_ACCOUNT" --arg repo "$1" --arg branch "$2" '{
      Version: "2012-10-17",
      Statement: [{
        Effect: "Allow",
        Principal: {Federated: ("arn:aws:iam::" + $account + ":oidc-provider/token.actions.githubusercontent.com")},
        Action: "sts:AssumeRoleWithWebIdentity",
        Condition: {StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": ("repo:" + $repo + ":ref:refs/heads/" + $branch)
        }}
      }]
    }'
}

ensure_schema_role() {
    log "Step 7: GitHub Actions OIDC role ${SCHEMA_ROLE_NAME}."
    ensure_oidc_provider

    local trust_policy
    trust_policy=$(github_trust_policy "$SCHEMA_GITHUB_REPO" "$SCHEMA_GITHUB_BRANCH")

    if SCHEMA_ROLE_ARN=$(aws iam get-role --role-name "$SCHEMA_ROLE_NAME" \
            --query 'Role.Arn' --output text 2>/dev/null); then
        log "  exists: ${SCHEMA_ROLE_ARN}; updating trust policy."
        aws iam update-assume-role-policy \
            --role-name "$SCHEMA_ROLE_NAME" \
            --policy-document "$trust_policy"
    else
        SCHEMA_ROLE_ARN=$(aws iam create-role \
            --role-name "$SCHEMA_ROLE_NAME" \
            --assume-role-policy-document "$trust_policy" \
            --description "GitHub Actions OIDC role for benchmarks-website Postgres schema deploys" \
            --tags "Key=${TAG_KEY_PROJECT},Value=${TAG_VAL_PROJECT}" \
                   "Key=${TAG_KEY_OWNER},Value=${TAG_VAL_OWNER}" \
            --query 'Role.Arn' --output text)
        log "  created: ${SCHEMA_ROLE_ARN}"
    fi

    # rds-db:connect for the migrator Postgres user, scoped to the INSTANCE
    # resource only (CI schema deploys connect to the public instance endpoint).
    # The Postgres user `migrator` is created in PR-1.3 migrations/002.
    local rds_arn_account="$TARGET_ACCOUNT"

    local permissions_policy
    permissions_policy=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["rds-db:connect"],
    "Resource": [
      "arn:aws:rds-db:${TARGET_REGION}:${rds_arn_account}:dbuser:${DB_RESOURCE_ID}/${PG_MIGRATOR_ROLE}"
    ]
  }]
}
EOF
)

    aws iam put-role-policy \
        --role-name "$SCHEMA_ROLE_NAME" \
        --policy-name "rds-db-connect-migrator" \
        --policy-document "$permissions_policy" \
        >/dev/null
    log "  inline permissions policy applied (rds-db:connect for ${PG_MIGRATOR_ROLE} on instance)."
}

ensure_ingest_role() {
    log "Step 7b: GitHub Actions OIDC role ${INGEST_ROLE_NAME}."
    ensure_oidc_provider

    local trust_policy
    trust_policy=$(github_trust_policy "$INGEST_GITHUB_REPO" "$INGEST_GITHUB_BRANCH")

    if INGEST_ROLE_ARN=$(aws iam get-role --role-name "$INGEST_ROLE_NAME" \
            --query 'Role.Arn' --output text 2>/dev/null); then
        log "  exists: ${INGEST_ROLE_ARN}; updating trust policy."
        aws iam update-assume-role-policy \
            --role-name "$INGEST_ROLE_NAME" \
            --policy-document "$trust_policy"
    else
        INGEST_ROLE_ARN=$(aws iam create-role \
            --role-name "$INGEST_ROLE_NAME" \
            --assume-role-policy-document "$trust_policy" \
            --description "GitHub Actions OIDC role for benchmarks-website Postgres dual-write ingest" \
            --tags "Key=${TAG_KEY_PROJECT},Value=${TAG_VAL_PROJECT}" \
                   "Key=${TAG_KEY_OWNER},Value=${TAG_VAL_OWNER}" \
            --query 'Role.Arn' --output text)
        log "  created: ${INGEST_ROLE_ARN}"
    fi

    # rds-db:connect for the bench_ingest Postgres user on the INSTANCE resource
    # only (CI ingest connects to the public instance endpoint, same as schema
    # deploys). The Postgres user `bench_ingest` is
    # created in PR-2.1 migrations/004 with data-DML-only grants.
    local rds_arn_account="$TARGET_ACCOUNT"

    local permissions_policy
    permissions_policy=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["rds-db:connect"],
    "Resource": [
      "arn:aws:rds-db:${TARGET_REGION}:${rds_arn_account}:dbuser:${DB_RESOURCE_ID}/${PG_INGEST_ROLE}"
    ]
  }]
}
EOF
)

    aws iam put-role-policy \
        --role-name "$INGEST_ROLE_NAME" \
        --policy-name "rds-db-connect-ingest" \
        --policy-document "$permissions_policy" \
        >/dev/null
    log "  inline permissions policy applied (rds-db:connect for ${PG_INGEST_ROLE} on instance)."
}

# -----------------------------------------------------------------------------
# Step 8: Summary.
# -----------------------------------------------------------------------------

print_summary() {
    cat <<EOF

=========================================================================
PROVISIONING COMPLETE.

RDS instance     : ${DB_INSTANCE_IDENTIFIER}
RDS endpoint     : ${DB_ENDPOINT}:5432
RDS resource-id  : ${DB_RESOURCE_ID}
Master secret    : ${DB_MASTER_SECRET_ARN}
Backup replica   : ${BACKUP_REPLICA_REGION}, ${BACKUP_REPLICA_RETENTION_DAYS} days
Alarm topic      : ${ALARM_TOPIC_ARN}
Schema role ARN  : ${SCHEMA_ROLE_ARN}
Ingest role ARN  : ${INGEST_ROLE_ARN}

NEXT STEPS:

1. Set these GitHub Actions repository VARIABLES (not secrets):
     # CI writers (schema-deploy + ingest) connect to the public INSTANCE
     # endpoint with direct IAM. The Vercel reader uses the same endpoint
     # and is configured through Vercel env vars, NOT GitHub Actions variables.
     gh variable set RDS_BENCH_INSTANCE_ENDPOINT --body "${DB_ENDPOINT}"
     gh variable set RDS_BENCH_REGION   --body "${TARGET_REGION}"
     gh variable set RDS_BENCH_DB_NAME  --body "${DB_NAME}"
     gh variable set GH_BENCH_SCHEMA_ROLE_ARN --body "${SCHEMA_ROLE_ARN}"
     gh variable set GH_BENCH_INGEST_ROLE_ARN --body "${INGEST_ROLE_ARN}"

2. If ALARM_HTTPS_ENDPOINT was unset, subscribe the incident.io CloudWatch
   alert source to the alarm topic:
     aws sns subscribe --topic-arn ${ALARM_TOPIC_ARN} --protocol https \\
       --notification-endpoint "\$ALARM_HTTPS_ENDPOINT"

3. Verify the instance:
     aws rds describe-db-instances --db-instance-identifier ${DB_INSTANCE_IDENTIFIER} \\
       --query 'DBInstances[0].[DBInstanceStatus,IAMDatabaseAuthenticationEnabled,DeletionProtection,MaxAllocatedStorage]'
     # expected: available  True  True  ${DB_MAX_ALLOCATED_STORAGE_GB}

4. Migrations create the Postgres '${PG_MIGRATOR_ROLE}' (002) and
   '${PG_INGEST_ROLE}' (004) users; both OIDC roles' permission policies are
   already scoped to those users. During the one-time bootstrap, apply EVERY
   migration carrying the '-- migrate-schema: requires-superuser' marker as the
   RDS master (currently 002/004/005, which create roles + grants, and 006/007,
   which run DDL on the master-owned query_measurements table). The marker in
   each file is authoritative; see bench/migrations/README.md
   'Bootstrap ordering' for the contract. After the bootstrap, unmarked schema
   deploys run as '${PG_MIGRATOR_ROLE}'.

=========================================================================
EOF
}

# -----------------------------------------------------------------------------
# Main.
# -----------------------------------------------------------------------------

main() {
    [ -z "${GITHUB_REPO+x}" ] || die "GITHUB_REPO was replaced by SCHEMA_GITHUB_REPO and INGEST_GITHUB_REPO."
    if [ "$#" -gt 0 ]; then
        if [ "$#" -eq 2 ] && [ "$1" = "--print-trust" ]; then
            case "$2" in
                schema) github_trust_policy "$SCHEMA_GITHUB_REPO" "$SCHEMA_GITHUB_BRANCH" ;;
                ingest) github_trust_policy "$INGEST_GITHUB_REPO" "$INGEST_GITHUB_BRANCH" ;;
                *) die "Expected schema or ingest." ;;
            esac
            return
        fi
        die "Usage: provision.sh [--print-trust schema|ingest]"
    fi
    verify_prereqs
    discover_default_vpc
    ensure_db_subnet_group
    ensure_security_group
    ensure_parameter_group
    ensure_rds_instance
    ensure_backup_replication
    ensure_alarms
    ensure_schema_role
    ensure_ingest_role
    print_summary
}

main "$@"
