#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
shared_mount="${1:-/mnt/osu-pulse}"
unit_dir="${HOME}/.config/systemd/user"

if [[ ! -d "$shared_mount/osu-pulse-shared" ]]; then
  echo "[ERROR] Mount the exFAT USB at $shared_mount first." >&2
  exit 1
fi
missing_commands=()
for command in node npm python3 java ffmpeg pg_dump pg_restore pg_isready xvfb-run xauth cloudflared; do
  command -v "$command" >/dev/null || missing_commands+=("$command")
done
if (( ${#missing_commands[@]} > 0 )); then
  echo "[ERROR] 必要なコマンドが不足しています: ${missing_commands[*]}" >&2
  echo "Archでは次を実行してから再試行してください:" >&2
  echo "  sudo pacman -S --needed nodejs npm python jre-openjdk-headless ffmpeg postgresql" >&2
  exit 1
fi

for prerequisite in node_modules/.bin/dotenv .next/BUILD_ID renderer/.venv/bin/python renderer/.venv-mania/bin/python renderer/local/osu-mania-renderer/osu_mania_renderer_v2/__init__.py lavalink/runtime/Lavalink.jar; do
  [[ -f "$project_root/$prerequisite" ]] || { echo "[ERROR] Missing runtime prerequisite: $prerequisite. Run scripts/setup-usb-arch.sh first." >&2; exit 1; }
done

mkdir -p "$unit_dir"

write_unit() {
  local name="$1" description="$2" command="$3"
  cat > "$unit_dir/$name.service" <<UNIT
[Unit]
Description=$description
PartOf=osu-pulse.target
After=network-online.target
Wants=network-online.target
RequiresMountsFor=$shared_mount
After=osu-pulse-db-sync.service
Requires=osu-pulse-db-sync.service

[Service]
Type=simple
WorkingDirectory="$project_root"
ExecStart=/usr/bin/env bash -lc '$command'
Restart=on-failure
RestartSec=5
TimeoutStopSec=45

[Install]
WantedBy=osu-pulse.target
UNIT
}

write_unit "osu-pulse-web" "osu! Pulse Web UI" "npm run start:local"
write_unit "osu-pulse-bot" "osu! Pulse Discord Bot" "npm run bot:start"
write_unit "osu-pulse-renderer" "osu! Pulse Replay Renderer" "xvfb-run -a renderer/.venv/bin/python -m renderer.server"
write_unit "osu-pulse-lavalink" "osu! Pulse Lavalink" "./node_modules/.bin/dotenv -e .env.local -- node lavalink/run-local.mjs"
write_unit "osu-pulse-tunnel" "osu! Pulse public tunnel and Vercel bridge" "bash scripts/start-public-tunnel.sh"

cat > "$unit_dir/osu-pulse-db-sync.service" <<UNIT
[Unit]
Description=osu! Pulse shared database startup synchronization
PartOf=osu-pulse.target
After=network-online.target
Wants=network-online.target
RequiresMountsFor=$shared_mount

[Service]
Type=oneshot
WorkingDirectory="$project_root"
ExecStart=/usr/bin/env bash "$project_root/scripts/sync-shared-database.sh" pull
ExecStop=/usr/bin/env bash "$project_root/scripts/sync-shared-database.sh" push
RemainAfterExit=yes
TimeoutStartSec=180
TimeoutStopSec=180

[Install]
WantedBy=osu-pulse.target
UNIT

cat > "$unit_dir/osu-pulse-db-snapshot.service" <<UNIT
[Unit]
Description=osu! Pulse periodic shared database snapshot
After=osu-pulse-db-sync.service
Requires=osu-pulse-db-sync.service
RequiresMountsFor=$shared_mount

[Service]
Type=oneshot
WorkingDirectory="$project_root"
ExecStart=/usr/bin/env bash "$project_root/scripts/sync-shared-database.sh" push
TimeoutStartSec=180
UNIT

cat > "$unit_dir/osu-pulse-db-snapshot.timer" <<UNIT
[Unit]
Description=Save the osu! Pulse database to shared storage every five minutes
PartOf=osu-pulse.target

[Timer]
OnBootSec=5min
OnUnitActiveSec=5min
AccuracySec=30s
Persistent=true

[Install]
WantedBy=timers.target
UNIT

cat > "$unit_dir/osu-pulse.target" <<UNIT
[Unit]
Description=osu! Pulse local services
Wants=osu-pulse-db-sync.service osu-pulse-db-snapshot.timer osu-pulse-web.service osu-pulse-bot.service osu-pulse-renderer.service osu-pulse-lavalink.service osu-pulse-tunnel.service
After=network-online.target

[Install]
WantedBy=default.target
UNIT

systemctl --user daemon-reload
systemctl --user enable osu-pulse.target
systemctl --user enable osu-pulse-db-snapshot.timer
if command -v loginctl >/dev/null && [[ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null || true)" != "yes" ]]; then
  echo "[INFO] ログイン前から起動するため、systemd user lingeringを有効化します。"
  if ! sudo loginctl enable-linger "$USER"; then
    echo "[WARN] lingeringを有効化できませんでした。ログイン後の自動起動は有効です。" >&2
    echo "       後で実行: sudo loginctl enable-linger $USER" >&2
  fi
fi
echo "[OK] Arch user services installed and enabled."
echo "Start now: systemctl --user start osu-pulse.target"
echo "Status:    systemctl --user status 'osu-pulse-*'"
