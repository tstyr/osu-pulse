#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
origin="${1:-}"
[[ "$origin" =~ ^https://[a-z0-9-]+\.trycloudflare\.com$ ]] || { echo '[ERROR] Invalid public tunnel origin.' >&2; exit 1; }
mkdir -p "$project_root/work"
exec 9>"$project_root/work/vercel-proxy-sync.lock"
flock -n 9 || exit 0
vercel_cli="$project_root/work/vercel-cli/node_modules/.bin/vercel"
if [[ ! -x "$vercel_cli" ]]; then
  echo '[ERROR] Run scripts/setup-usb-arch.sh to install and authenticate the Vercel CLI.' >&2
  exit 1
fi
state="$project_root/work/vercel-proxy-origin.txt"
if [[ -f "$state" && "$(tr -d '\r\n' < "$state")" == "$origin" ]]; then exit 0; fi
cd "$project_root"
# CLI credentials live in the Arch user's home, never in the USB package.
"$vercel_cli" whoami >/dev/null
"$vercel_cli" env add LOCAL_WEB_ORIGIN production --value "$origin" --force --yes --no-sensitive
"$vercel_cli" deploy --prod --yes
printf '%s\n' "$origin" > "${state}.new"
mv -- "${state}.new" "$state"
echo "[OK] Vercel now proxies to $origin"
