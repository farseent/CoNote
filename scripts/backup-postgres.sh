#!/usr/bin/env bash
# Logical backup of the CoNote database (docs/DEPLOYMENT.md §7, §14).
#
#   scripts/backup-postgres.sh [output-dir]        (default: ./backups, created with mode 700)
#
# Production (Docker Compose, run on the server from the repository root): the dump is made inside
# the postgres container and written to the host. For a PostgreSQL that is not in that Compose
# project set BACKUP_DIRECT=1 and the usual PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE variables.
# The dump is the custom format (`pg_restore` reads it). It contains ALL application data and
# password hashes: keep it private, copy it off the server and encrypt it there.
set -euo pipefail

out="${1:-backups}"
mkdir -p "$out"
chmod 700 "$out"
umask 077
file="$out/conote-$(date -u +%Y%m%dT%H%M%SZ).dump"

if [ "${BACKUP_DIRECT:-0}" = "1" ]; then
  pg_dump -Fc > "$file"
else
  docker compose --env-file .env.production -f infra/docker-compose.prod.yml \
    exec -T postgres pg_dump -U conote -d conote -Fc > "$file"
fi

# An empty or truncated dump must not look like a backup.
if [ ! -s "$file" ] || ! pg_restore --list "$file" > /dev/null 2>&1; then
  if command -v pg_restore > /dev/null 2>&1; then
    echo "backup failed: $file is not a readable dump" >&2
    rm -f "$file"
    exit 1
  fi
fi
echo "$file ($(wc -c < "$file") bytes)"