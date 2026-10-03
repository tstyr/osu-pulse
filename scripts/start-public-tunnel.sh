#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$project_root/work"
url_path="$project_root/work/public-web-url.txt"
log_path="$project_root/work/cloudflared.log"
for _ in $(seq 1 90); do
  if curl --fail --silent --max-time 3 http://127.0.0.1:3000/api/health >/dev/null; then break; fi
  sleep 2
done
curl --fail --silent --max-time 3 http://127.0.0.1:3000/api/health >/dev/null || { echo '[ERROR] Web UI is not ready.' >&2; exit 1; }
origin=''
cloudflared tunnel --no-autoupdate --protocol http2 --url http://127.0.0.1:3000 2>&1 | while IFS= read -r line; do
  printf '%s\n' "$line" | tee -a "$log_path"
  if [[ -z "$origin" && "$line" =~ https://[a-z0-9-]+\.trycloudflare\.com ]]; then
    origin="${BASH_REMATCH[0]}"
    printf '%s\n' "$origin" > "${url_path}.new"
    mv -- "${url_path}.new" "$url_path"
    # A first-time DNS delay is normal; retry sync within this service's group.
    (
      for _ in $(seq 1 6); do
        if curl --fail --silent --max-time 10 "$origin/api/health" >/dev/null &&
          bash "$project_root/scripts/sync-vercel-web-proxy.sh" "$origin"; then exit 0; fi
        sleep 15
      done
      echo '[ERROR] Vercel sync failed. Check Vercel login/link and work/vercel-proxy-sync.log.'
    ) >> "$project_root/work/vercel-proxy-sync.log" 2>&1 &
  fi
done
