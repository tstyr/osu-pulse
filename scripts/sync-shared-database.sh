#!/usr/bin/env bash
set -euo pipefail

mode="${1:-}"
if [[ "$mode" != "push" && "$mode" != "pull" ]]; then
  echo "Usage: $0 push|pull" >&2
  exit 2
fi

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="$project_root/.env.local"
read_env() {
  local key="$1" value
  value="$(sed -n "s/^${key}=//p" "$env_file" | tail -n 1 | tr -d '\r')"
  value="${value#\'}"; value="${value%\'}"
  value="${value#\"}"; value="${value%\"}"
  printf '%s' "$value"
}

shared_root="$(read_env OSU_PULSE_SHARED_ROOT)"
database_url="$(read_env DATABASE_URL)"
[[ -d "$shared_root" ]] || { echo "[ERROR] Shared storage is unavailable: $shared_root" >&2; exit 1; }
[[ -n "$database_url" ]] || { echo "[ERROR] DATABASE_URL is not configured." >&2; exit 1; }
for command in node pg_dump pg_restore pg_isready python3 flock; do
  command -v "$command" >/dev/null || { echo "[ERROR] Missing command: $command" >&2; exit 1; }
done

mkdir -p "$shared_root/backups/database" "$project_root/work/db-safety"
exec 9>"$project_root/work/shared-db-sync.lock"
flock -n 9 || { echo "[SKIP] Another database synchronization is already running."; exit 0; }

db_configuration="$(DATABASE_URL="$database_url" python3 - <<'PY'
import os
from urllib.parse import unquote, urlsplit
u = urlsplit(os.environ["DATABASE_URL"])
if u.scheme not in ('postgres', 'postgresql') or u.hostname not in ('localhost', '127.0.0.1', '::1'):
    raise SystemExit('Shared synchronization only supports a local PostgreSQL DATABASE_URL.')
values = (u.hostname or "", str(u.port or 5432), unquote(u.username or ""), unquote(u.password or ""), unquote(u.path.lstrip("/")))
for value in values:
    # A URL-escaped password may contain whitespace, but never a NUL.
    print(value.encode('utf-8').hex())
PY
)"
mapfile -d '' -t db_parts < <(python3 - "$db_configuration" <<'PY'
import sys
for value in sys.argv[1].splitlines():
    print(bytes.fromhex(value).decode('utf-8'), end='\0')
PY
)
export PGHOST="${db_parts[0]}" PGPORT="${db_parts[1]}" PGUSER="${db_parts[2]}" PGPASSWORD="${db_parts[3]}" PGDATABASE="${db_parts[4]}"

database_ready=false
for _ in $(seq 1 60); do
  if pg_isready --quiet; then database_ready=true; break; fi
  sleep 1
done
[[ "$database_ready" == true ]] || { echo "[ERROR] Local PostgreSQL did not become ready." >&2; exit 1; }

snapshot_directory="$shared_root/backups/database"
snapshot_tool="$project_root/scripts/shared-db-snapshot.mjs"
state_path="$project_root/work/shared-db-applied.id"

if [[ "$mode" == "push" ]]; then
  node "$snapshot_tool" prepare-push "$snapshot_directory" "$state_path"
  temporary_path="$shared_root/backups/database/osu-pulse.$$.tmp"
  trap 'rm -f "$temporary_path"' EXIT
  pg_dump --format=custom --compress=6 --no-owner --no-acl --file "$temporary_path"
  [[ -s "$temporary_path" ]] || { echo "[ERROR] Database dump is empty." >&2; exit 1; }
  snapshot_id="$(node "$snapshot_tool" publish "$snapshot_directory" "$state_path" "$temporary_path" arch)"
  echo "[OK] Shared database snapshot saved: $snapshot_id"
  exit 0
fi

snapshot="$(node "$snapshot_tool" resolve-pull "$snapshot_directory")"
if [[ -z "$snapshot" ]]; then
  echo "[SKIP] No shared database snapshot exists yet."
  exit 0
fi
snapshot_id="${snapshot%%$'\n'*}"
dump_path="${snapshot#*$'\n'}"
applied_id="$(test -f "$state_path" && tr -d '\r\n' < "$state_path" || true)"
if [[ -n "$snapshot_id" && "$snapshot_id" == "$applied_id" ]]; then
  echo "[SKIP] Shared database snapshot is already applied: $snapshot_id"
  exit 0
fi

node "$snapshot_tool" guard-restore "$project_root"
pg_restore --list "$dump_path" >/dev/null
safety_dump="$project_root/work/db-safety/before-shared-pull-$(date -u +%Y%m%d-%H%M%S).dump"
pg_dump --format=custom --compress=6 --no-owner --no-acl --file "$safety_dump"
pg_restore --clean --if-exists --no-owner --no-acl --exit-on-error --single-transaction --dbname "$PGDATABASE" "$dump_path"
node "$snapshot_tool" mark-applied "$snapshot_directory" "$state_path" "$snapshot_id"
echo "[OK] Shared database snapshot restored: $snapshot_id"
