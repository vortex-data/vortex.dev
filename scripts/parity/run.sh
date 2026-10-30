#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: Copyright the Vortex contributors
#
# Serve two builds of bench against one restored production database, then compare their API
# responses, their pages' status, headers and titles, and screenshots of the pages in the light and
# dark themes. Exits 0 when nothing differs.
#
#   bash scripts/parity/run.sh <base-ref> <dump-dir>
#
# <base-ref> is a git ref for the build to compare against (for example origin/main). The head
# build is the current working tree. <dump-dir> is a directory-format pg_dump, or a directory that
# holds one in `vortex_bench.dir`. The script only reads it. See README.md for the details.

set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: bash scripts/parity/run.sh <base-ref> <dump-dir>" >&2
  exit 2
fi
BASE_REF=$1
DUMP=${2/#\~/$HOME}

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO=$(git -C "$HERE" rev-parse --show-toplevel)

TMP_ROOT=${TMPDIR:-/tmp}
WORK=${TMP_ROOT%/}/bench-parity
PGDATA=${PARITY_PGDATA:-$WORK/pgdata}
BASE_DIR=$WORK/base
OUT=$WORK/out

# Postgres 16 binaries: initdb, pg_ctl, createdb and psql. Homebrew installs postgresql@16
# keg-only, so the default points there; other machines set PG_BIN.
PG_BIN=${PG_BIN:-/opt/homebrew/opt/postgresql@16/bin}
PG_PORT=55432
DB_NAME=vortex_bench
BASE_PORT=3101
HEAD_PORT=3102
# The host proxies (host-proxy.mjs), which present a server's bench as bench.vortex.dev serves it.
HEAD_HOST_PORT=3103
BASE_HOST_PORT=3104
BENCH_HOST=bench.vortex.dev

die() {
  echo "parity: $*" >&2
  exit 2
}

log() {
  echo "parity: $*"
}

# ---- Preconditions -----------------------------------------------------------------------------

BASE_SHA=$(git -C "$REPO" rev-parse --verify --quiet "$BASE_REF^{commit}") ||
  die "'$BASE_REF' is not a git ref in $REPO"
HEAD_SHA=$(git -C "$REPO" rev-parse HEAD)

if [[ -f $DUMP/toc.dat ]]; then
  ARCHIVE=$DUMP
elif [[ -f $DUMP/vortex_bench.dir/toc.dat ]]; then
  ARCHIVE=$DUMP/vortex_bench.dir
else
  die "no directory-format pg_dump (toc.dat) in '$DUMP' or '$DUMP/vortex_bench.dir'"
fi
# Names the dump that the data directory holds, so a different dump restores again.
RESTORE_MARK="parity-restore:$(basename "$DUMP")"

for tool in initdb pg_ctl psql; do
  [[ -x $PG_BIN/$tool ]] || die "$PG_BIN/$tool not found; set PG_BIN to a Postgres 16 bin directory"
done
for tool in git node bun tar curl; do
  command -v "$tool" >/dev/null || die "'$tool' is not installed"
done
PLAYWRIGHT=$REPO/node_modules/.bin/playwright
[[ -x $PLAYWRIGHT ]] || die "Playwright is missing; run 'bun install' at the repository root"

port_busy() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

# A dump made by a newer pg_dump needs a pg_restore at least as new, which Postgres 16's may not
# be. Use the first candidate that can read this archive.
find_pg_restore() {
  local libpq candidate
  libpq=$(brew --prefix libpq 2>/dev/null || true)
  for candidate in "${PG_RESTORE:-}" "$PG_BIN/pg_restore" "${libpq:+$libpq/bin/pg_restore}" \
    "$(command -v pg_restore || true)"; do
    if [[ -n $candidate && -x $candidate ]] && "$candidate" -l "$ARCHIVE" >/dev/null 2>&1; then
      echo "$candidate"
      return 0
    fi
  done
  die "no pg_restore can read $ARCHIVE; install a pg_restore at least as new as the pg_dump that wrote it, or set PG_RESTORE"
}

# ---- Cleanup -----------------------------------------------------------------------------------

SERVER_PIDS=()

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  local pid
  for pid in ${SERVER_PIDS[@]+"${SERVER_PIDS[@]}"}; do
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  done
  for pid in ${SERVER_PIDS[@]+"${SERVER_PIDS[@]}"}; do
    wait "$pid" 2>/dev/null || true
  done
  if [[ -f $PGDATA/postmaster.pid ]]; then
    "$PG_BIN/pg_ctl" -D "$PGDATA" -m fast -w stop >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# ---- Postgres ----------------------------------------------------------------------------------

mkdir -p "$WORK"

if [[ ! -f $PGDATA/PG_VERSION ]]; then
  log "creating a Postgres data directory in $PGDATA"
  mkdir -p "$PGDATA"
  "$PG_BIN/initdb" -D "$PGDATA" -U postgres -A trust -E UTF8 --locale=C >/dev/null
fi

if ! "$PG_BIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
  port_busy "$PG_PORT" && die "port $PG_PORT is in use by something else"
  log "starting Postgres on port $PG_PORT"
  # The server is throwaway: skip the durability work that slows a restore down. It listens on
  # loopback only, and has no Unix socket.
  "$PG_BIN/pg_ctl" -D "$PGDATA" -l "$WORK/postgres.log" -w start -o "\
    -p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories= \
    -c fsync=off -c synchronous_commit=off -c full_page_writes=off \
    -c shared_buffers=1GB -c maintenance_work_mem=1GB -c max_wal_size=16GB" >/dev/null
fi

psql_admin() {
  "$PG_BIN/psql" -h 127.0.0.1 -p "$PG_PORT" -U postgres -X -q -v ON_ERROR_STOP=1 "$@"
}

db_mark=$(psql_admin -d postgres -At -c \
  "SELECT coalesce(shobj_description(oid, 'pg_database'), '') FROM pg_database WHERE datname = '$DB_NAME'")
has_commits=no
if [[ -n $db_mark ]]; then
  has_commits=$(psql_admin -d "$DB_NAME" -At -c \
    "SELECT CASE WHEN to_regclass('public.commits') IS NULL THEN 'no' ELSE 'yes' END")
fi

# pg_restore 17 and later sets transaction_timeout on every connection, which Postgres 16 rejects.
# That error is harmless. Any other error is not.
restore_database() {
  local pg_restore_bin restore_log=$WORK/pg_restore.log restore_status=0 unexpected
  pg_restore_bin=$(find_pg_restore)
  log "restoring $ARCHIVE with $("$pg_restore_bin" --version); this takes minutes"
  psql_admin -d postgres -c "DROP DATABASE IF EXISTS $DB_NAME"
  psql_admin -d postgres -c "CREATE DATABASE $DB_NAME"
  "$pg_restore_bin" --no-owner --no-privileges -j 4 \
    -h 127.0.0.1 -p "$PG_PORT" -U postgres -d "$DB_NAME" "$ARCHIVE" 2>"$restore_log" ||
    restore_status=$?
  unexpected=$(grep -v \
    -e 'unrecognized configuration parameter "transaction_timeout"' \
    -e '^Command was: SET transaction_timeout = 0;$' \
    -e '^pg_restore: warning: errors ignored on restore: ' "$restore_log" || true)
  if [[ -n $unexpected || ($restore_status -ne 0 && ! -s $restore_log) ]]; then
    echo "$unexpected" >&2
    die "pg_restore failed (exit $restore_status); its output is in $restore_log"
  fi
  psql_admin -d "$DB_NAME" -c "ANALYZE"
  # Written last, so an interrupted restore is not mistaken for a finished one.
  psql_admin -d postgres -c "COMMENT ON DATABASE $DB_NAME IS '$RESTORE_MARK'"
}

if [[ $db_mark == "$RESTORE_MARK" && $has_commits == yes ]]; then
  log "reusing the restored database ($RESTORE_MARK)"
else
  restore_database
fi

# Print every table's row count, and warn when it differs from the dump's rowcounts.txt (which
# may have been taken a little after the dump).
while read -r table _; do
  actual=$(psql_admin -d "$DB_NAME" -At -c "SELECT count(*) FROM public.\"$table\"")
  expected=$(awk -v t="$table" '$1 == t { print $2 }' "$DUMP/rowcounts.txt" 2>/dev/null || true)
  note=
  [[ -z $expected || $expected == "$actual" ]] || note=" (rowcounts.txt says $expected)"
  log "  $table: $actual rows$note"
done < <(psql_admin -d "$DB_NAME" -At -c \
  "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")

# ---- Builds ------------------------------------------------------------------------------------

export NEXT_TELEMETRY_DISABLED=1

log "exporting $BASE_REF ($BASE_SHA) to $BASE_DIR"
rm -rf "$BASE_DIR"
mkdir -p "$BASE_DIR"
git -C "$REPO" archive "$BASE_REF" | tar -x -C "$BASE_DIR"

# Where a checkout's bench app is. Before bench moved into the site's app, it was its own app in
# bench/web, served from the root. Since, it is the repository root's app, served under /bench,
# and from the root only through bench.vortex.dev's host.
app_dir() {
  if [[ -f $1/bench/web/package.json ]]; then
    echo "$1/bench/web"
  else
    echo "$1"
  fi
}
own_app() {
  [[ $(app_dir "$1") != "$1" ]]
}

# Each side builds the way its own tree says. `next build` needs no database.
build_side() {
  local label=$1 dir=$2
  log "building $label in $(app_dir "$dir")"
  (cd "$dir" && bun install --frozen-lockfile)
  (cd "$(app_dir "$dir")" && bun run build)
}
build_side base "$BASE_DIR"
build_side head "$REPO"

# ---- Servers -----------------------------------------------------------------------------------

start_server() {
  local label=$1 dir=$2 port=$3 app next_bin
  app=$(app_dir "$dir")
  port_busy "$port" && die "port $port is in use, so $label would not be the server that answers"
  next_bin=$(cd "$app" && node -p "require.resolve('next/dist/bin/next')")
  # The Data Cache (`unstable_cache`) persists under `.next/cache`, and the head's `.next` belongs to
  # the working tree, so an earlier run's payloads could answer in place of this build's code. Start
  # every server with an empty `.next/cache`, whichever part of it a Next.js version keeps them in.
  rm -rf "$app/.next/cache"
  log "serving $label on port $port"
  # Job control gives the server its own process group, so one kill reaches Next.js and any child.
  # It stays off otherwise, so Ctrl-C still reaches every foreground command.
  set -m
  (
    cd "$app"
    exec env \
      NODE_ENV=production \
      BENCH_DB_HOST=127.0.0.1 BENCH_DB_PORT=$PG_PORT BENCH_DB_NAME=$DB_NAME \
      BENCH_DB_USER=postgres BENCH_DB_PASSWORD=parity BENCH_DB_SSL=disable \
      node "$next_bin" start -H 127.0.0.1 -p "$port"
  ) >"$WORK/$label.log" 2>&1 &
  SERVER_PIDS+=($!)
  set +m
}

# Present a server as bench.vortex.dev on another port (see host-proxy.mjs).
start_host_proxy() {
  local label=$1 port=$2 target=$3
  port_busy "$port" && die "port $port is in use, so $label would not be the proxy that answers"
  set -m
  node "$HERE/host-proxy.mjs" "$port" "$target" "$BENCH_HOST" >"$WORK/$label.log" 2>&1 &
  SERVER_PIDS+=($!)
  set +m
}

wait_ready() {
  local label=$1 url=$2 pid=$3 attempt
  for attempt in $(seq 1 120); do
    kill -0 "$pid" 2>/dev/null || {
      cat "$WORK/$label.log" >&2
      die "the $label server stopped before it was ready"
    }
    curl -fsS --max-time 5 -o /dev/null "$url/api/health" 2>/dev/null && return 0
    sleep 1
  done
  cat "$WORK/$label.log" >&2
  die "the $label server did not answer $url/api/health within 2 minutes"
}

start_server base "$BASE_DIR" "$BASE_PORT"
BASE_PID=$!
start_server head "$REPO" "$HEAD_PORT"
HEAD_PID=$!
# The head's bench under /bench, as previews and local dev serve it.
HEAD_PREFIX_URL=http://127.0.0.1:$HEAD_PORT/bench
# bench as its visitors see it: an old base's own root, or the app through bench.vortex.dev's host.
if own_app "$BASE_DIR"; then
  wait_ready base "http://127.0.0.1:$BASE_PORT" "$BASE_PID"
  BASE_URL=http://127.0.0.1:$BASE_PORT
else
  wait_ready base "http://127.0.0.1:$BASE_PORT/bench" "$BASE_PID"
  start_host_proxy base-proxy "$BASE_HOST_PORT" "http://127.0.0.1:$BASE_PORT"
  BASE_URL=http://127.0.0.1:$BASE_HOST_PORT
  wait_ready base-proxy "$BASE_URL" "$!"
fi
wait_ready head "$HEAD_PREFIX_URL" "$HEAD_PID"
start_host_proxy head-proxy "$HEAD_HOST_PORT" "http://127.0.0.1:$HEAD_PORT"
HEAD_URL=http://127.0.0.1:$HEAD_HOST_PORT
wait_ready head-proxy "$HEAD_URL" "$!"

# ---- Comparisons -------------------------------------------------------------------------------

rm -rf "$OUT"
mkdir -p "$OUT"

# Compare the API and the pages' status, headers and titles of the base with one form of the head.
compare_api() {
  local label=$1 url=$2 status=0
  log "comparing the API and the pages' status, headers and titles ($label)"
  bun "$HERE/compare-api.ts" "$BASE_URL" "$url" 2>&1 | tee "$OUT/api-$label.log" || status=$?
  return "$status"
}
api_status=0
compare_api host "$HEAD_URL" || api_status=$?
compare_api prefix "$HEAD_PREFIX_URL" || api_status=$?
api_mismatches() {
  local count
  count=$(sed -n 's/^HTTP: .* \([0-9][0-9]*\) mismatches.*/\1/p' "$OUT/api-$1.log")
  echo "${count:-unknown}"
}

run_playwright() {
  local label=$1 url=$2 prefix=$3
  shift 3
  PARITY_OUT=$OUT BASE_URL=$url BENCH_PREFIX=$prefix \
    PLAYWRIGHT_JSON_OUTPUT_NAME="$OUT/screenshots-$label.json" \
    "$PLAYWRIGHT" test -c "$HERE/playwright.config.ts" "$@"
}
shots_unexpected() {
  node -p "require('$OUT/screenshots-$1.json').stats.unexpected" 2>/dev/null || echo unknown
}

log "taking the screenshots' baselines from the base server"
shots_status=0
run_playwright base "$BASE_URL" "" --update-snapshots=all || shots_status=$?
shots_host="unknown"
shots_prefix="unknown"
if [[ $shots_status -eq 0 ]]; then
  log "comparing the head's screenshots on bench.vortex.dev's host with the baselines"
  run_playwright head-host "$HEAD_URL" "" || shots_status=$?
  shots_host=$(shots_unexpected head-host)
  log "comparing the head's screenshots under /bench with the baselines"
  run_playwright head-prefix "http://127.0.0.1:$HEAD_PORT" /bench || shots_status=$?
  shots_prefix=$(shots_unexpected head-prefix)
fi
shots_total=$(find "$OUT/snapshots" -name '*.png' 2>/dev/null | wc -l | tr -d ' ')

# ---- Summary -----------------------------------------------------------------------------------

echo
echo "parity: base $BASE_REF ($BASE_SHA)"
echo "parity: head working tree at $HEAD_SHA ($(git -C "$REPO" status --porcelain | wc -l | tr -d ' ') changed paths)"
echo "parity: on $BENCH_HOST's host: $(tail -n 1 "$OUT/api-host.log")"
echo "parity: under /bench: $(tail -n 1 "$OUT/api-prefix.log")"
echo "parity: $shots_total screenshots; differ on $BENCH_HOST's host: $shots_host, under /bench: $shots_prefix"
echo "parity: wall time $((SECONDS / 60))m $((SECONDS % 60))s"
if [[ $api_status -ne 0 ]]; then
  echo "parity: response differences are listed above and in $OUT/api-*.log"
fi
if [[ $shots_status -ne 0 ]]; then
  echo "parity: screenshots or link checks that failed; each folder holds what Playwright kept:"
  find "$OUT/results" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort | while read -r result; do
    echo "parity:   $result"
  done
fi
if [[ $api_status -eq 0 && $shots_status -eq 0 ]]; then
  echo "parity: 0 mismatches"
  exit 0
fi
echo "parity: FAILED (response mismatches: $(api_mismatches host) on the host, $(api_mismatches prefix) under /bench; screenshots that differ: $shots_host on the host, $shots_prefix under /bench)"
exit 1
