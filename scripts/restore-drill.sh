#!/usr/bin/env bash
# Restore drill (docs/DEPLOYMENT.md §7, AC-11.3): restore a dump into a SCRATCH database and prove
# that every table matches the live database. It never touches the live database's data: it only
# reads it, and it creates and drops its own scratch database `conote_restore_drill`.
#
#   scripts/restore-drill.sh path/to/conote-….dump
#
# Compose mode (default, on the server) runs psql/pg_restore inside the postgres container; for a
# direct connection set RESTORE_DRILL_DIRECT=1 with PGHOST/PGPORT/PGUSER/PGPASSWORD set (the user
# needs CREATEDB) and PGDATABASE as the live database name.
#
# The fingerprint of a table is its row count and the MD5 of its sorted row texts, so a restore
# that lost or changed even one row (a collaborative document included: document_states and
# document_updates are tables) shows up. The time of the restore is printed: record it.
set -euo pipefail

dump="${1:?usage: scripts/restore-drill.sh path/to/dump}"
scratch="conote_restore_drill"
live="${PGDATABASE:-conote}"
[ "$scratch" != "$live" ] || { echo "refusing: scratch database equals the live database" >&2; exit 2; }

if [ "${RESTORE_DRILL_DIRECT:-0}" = "1" ]; then
  run_psql() { psql -v ON_ERROR_STOP=1 -X -At "$@"; }
  restore() { pg_restore --no-owner --no-privileges -d "$scratch" < "$dump"; }
else
  compose=(docker compose --env-file .env.production -f infra/docker-compose.prod.yml exec -T postgres)
  run_psql() { "${compose[@]}" psql -U conote -v ON_ERROR_STOP=1 -X -At "$@"; }
  restore() { "${compose[@]}" pg_restore -U conote --no-owner --no-privileges -d "$scratch" < "$dump"; }
fi

fingerprint() { # $1 = database
  local db="$1" table
  for table in $(run_psql -d "$db" -c "select tablename from pg_tables where schemaname='public' and tablename <> '_prisma_migrations' order by 1"); do
    printf '%s %s\n' "$table" "$(run_psql -d "$db" -c "select count(*) || ' ' || coalesce(md5(string_agg(t::text, '|' order by t::text)), 'empty') from \"$table\" t")"
  done
}

run_psql -d postgres -c "drop database if exists $scratch" > /dev/null
run_psql -d postgres -c "create database $scratch" > /dev/null
trap 'run_psql -d postgres -c "drop database if exists '"$scratch"'" > /dev/null' EXIT

start=$(date +%s)
restore
echo "restore took $(( $(date +%s) - start )) s"

fingerprint "$live" > /tmp/conote-drill-live.txt
fingerprint "$scratch" > /tmp/conote-drill-restored.txt
if diff -u /tmp/conote-drill-live.txt /tmp/conote-drill-restored.txt; then
  echo "RESTORE DRILL PASSED: $(wc -l < /tmp/conote-drill-live.txt) tables identical (count and content)"
else
  echo "RESTORE DRILL FAILED: the tables above differ" >&2
  exit 1
fi