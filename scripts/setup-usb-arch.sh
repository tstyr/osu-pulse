#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ! -t 0 && -z "${OSU_PULSE_ARCH_TERMINAL:-}" && ( -n "${DISPLAY:-}" || -n "${WAYLAND_DISPLAY:-}" ) ]]; then
  exec bash "$(dirname "${BASH_SOURCE[0]}")/arch-launcher.sh" --setup "$@"
fi

usb_app="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
usb_root="$(dirname "$usb_app")"
install_root="${XDG_DATA_HOME:-$HOME/.local/share}/osu-pulse"
mkdir -p "$usb_root/osu-pulse-shared/platform"
log_path="$usb_root/osu-pulse-shared/platform/arch-install.log"
exec > >(tee -a "$log_path") 2>&1
on_exit() {
  local code=$?
  if (( code != 0 )); then echo "[ERROR] Setup failed. Log: $log_path"; fi
  if [[ -t 0 ]]; then read -r -p 'Press Enter to close...' _ || true; fi
}
trap on_exit EXIT
[[ "$(uname -s)" == Linux ]] || { echo 'Run this launcher on Arch Linux.'; exit 1; }
[[ "$(uname -m)" == x86_64 ]] || { echo 'This package requires x86_64.'; exit 1; }
[[ -f "$usb_app/package.json" && -d "$usb_root/osu-pulse-shared" ]] || { echo 'USB application package is incomplete.'; exit 1; }

echo '[1/7] Installing Arch runtime packages'
sudo pacman -S --needed nodejs npm python python-pip jre-openjdk-headless ffmpeg postgresql rsync git curl unzip yt-dlp xorg-server-xvfb xorg-xauth mesa cloudflared

echo '[2/7] Registering a stable USB mount for automatic startup'
shared_mount=/mnt/osu-pulse
uuid="$(findmnt -n -o UUID --target "$usb_root")"
[[ -n "$uuid" ]] || { echo 'Cannot identify USB filesystem UUID.'; exit 1; }
fstype="$(findmnt -n -o FSTYPE --target "$usb_root")"
[[ "$fstype" == exfat ]] || { echo "Expected exFAT USB, found: $fstype"; exit 1; }
if ! findmnt --fstab -rn -o TARGET | grep -Fxq "$shared_mount"; then
  sudo mkdir -p "$shared_mount"
  printf 'UUID=%s %s exfat defaults,nofail,x-systemd.automount,uid=%s,gid=%s,umask=077 0 0\n' "$uuid" "$shared_mount" "$(id -u)" "$(id -g)" | sudo tee -a /etc/fstab >/dev/null
  sudo systemctl daemon-reload
fi
if ! mountpoint -q "$shared_mount"; then sudo mount "$shared_mount"; fi
[[ "$(findmnt -n -o UUID --target "$shared_mount")" == "$uuid" ]] || { echo '/mnt/osu-pulse belongs to another disk; setup stopped.'; exit 1; }
shared_root="$shared_mount/osu-pulse-shared"

echo '[3/7] Updating Arch application files from USB'
# Stop existing services before updating or restoring their database.
if systemctl --user cat osu-pulse.target >/dev/null 2>&1; then
  for unit in osu-pulse-db-snapshot.timer osu-pulse-tunnel.service osu-pulse-web.service osu-pulse-bot.service osu-pulse-renderer.service osu-pulse-lavalink.service; do
    if systemctl --user cat "$unit" >/dev/null 2>&1; then systemctl --user stop "$unit"; fi
  done
  systemctl --user stop osu-pulse-db-sync.service osu-pulse.target
fi
mkdir -p "$install_root"
chmod 700 "$install_root"
# Native modules and virtual environments live on the Linux filesystem.
# Local configuration survives repeat installations.
rsync -r --exclude='.env.local' --exclude='renderer/.env' --exclude=node_modules --exclude=.next --exclude=work --exclude=.git "$usb_app/" "$install_root/"
if [[ ! -f "$install_root/.env.local" ]]; then install -m 600 "$usb_app/.env.local" "$install_root/.env.local"; fi
if [[ ! -f "$install_root/renderer/.env" ]]; then install -m 600 "$usb_app/renderer/.env" "$install_root/renderer/.env"; fi
cd "$install_root"

echo '[4/7] Preparing local PostgreSQL'
unit_dir="$HOME/.config/systemd/user"
mkdir -p "$unit_dir" "$install_root/work/postgres-socket"
if [[ ! -f "$install_root/work/postgres/PG_VERSION" ]]; then
  initdb -D "$install_root/work/postgres" --username=postgres --auth-local=trust --auth-host=scram-sha-256 --encoding=UTF8 --locale=C.UTF-8
fi
cat > "$unit_dir/osu-pulse-postgres.service" <<UNIT
[Unit]
Description=osu! Pulse local PostgreSQL
[Service]
Type=simple
ExecStart=/usr/bin/postgres -D "$install_root/work/postgres" -h 127.0.0.1 -p 54329 -k "$install_root/work/postgres-socket"
Restart=on-failure
TimeoutStopSec=90
[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now osu-pulse-postgres.service
for _ in $(seq 1 60); do
  pg_isready -h "$install_root/work/postgres-socket" -p 54329 -q && break
  sleep 1
done
pg_isready -h "$install_root/work/postgres-socket" -p 54329 -q
python3 - "$install_root/.env.local" "$install_root/renderer/.env" "$install_root/work/postgres-socket" <<'PY'
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit
import subprocess, sys
root_env, renderer_env, socket = sys.argv[1:]
def parse(path):
    result = {}
    for line in Path(path).read_text(encoding='utf-8-sig').splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            key, value = line.split('=', 1)
            result[key] = value.strip().strip("'\"")
    return result
values = parse(root_env)
u = urlsplit(values['DATABASE_URL'])
if u.hostname not in ('localhost', '127.0.0.1', '::1') or unquote(u.username or '') != 'postgres':
    raise SystemExit('Expected the migrated local postgres account in DATABASE_URL.')
password = unquote(u.password or '')
database = unquote(u.path.lstrip('/'))
base = ['psql', '-h', socket, '-p', '54329', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q']
sql = "ALTER ROLE postgres PASSWORD '" + password.replace("'", "''") + "';"
subprocess.run(base, input=sql, text=True, check=True, stdout=subprocess.DEVNULL)
exists = subprocess.run(base + ['-tA'], input="SELECT 1 FROM pg_database WHERE datname='" + database.replace("'", "''") + "';", text=True, check=True, capture_output=True).stdout.strip()
if not exists:
    subprocess.run(['createdb', '-h', socket, '-p', '54329', '-U', 'postgres', database], check=True)
url = 'postgresql://postgres:' + quote(password, safe='') + '@127.0.0.1:54329/' + quote(database, safe='')
def update(path, replacements):
    lines = Path(path).read_text(encoding='utf-8-sig').splitlines()
    out = []
    for line in lines:
        key = line.split('=', 1)[0]
        if key in replacements:
            out.append(key + "='" + replacements.pop(key).replace("'", "\\'") + "'")
        else:
            out.append(line)
    out += [key + "='" + value + "'" for key, value in replacements.items()]
    Path(path).write_text('\n'.join(out) + '\n', encoding='utf-8')
update(root_env, {'DATABASE_URL': url, 'BOT_AUDIO_FFMPEG_PATH': 'ffmpeg', 'BOT_AUDIO_FFPROBE_PATH': 'ffprobe', 'LAVALINK_HOST': '127.0.0.1'})
update(renderer_env, {'DATABASE_URL': url, 'RENDER_NODE_PATH': 'node'})
PY
bash scripts/configure-shared-storage-arch.sh "$shared_root"
bash scripts/sync-shared-database.sh pull

echo '[5/7] Installing Node and Python dependencies'
bash scripts/install-arch-renderers.sh
npm ci
# Installed shortcuts live on the native filesystem, not on exFAT.
application_dir="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
mkdir -p "$application_dir"
node scripts/arch-desktop-entry.mjs native "$install_root/scripts/arch-launcher.sh" --start > "$application_dir/osu-pulse.desktop"
node scripts/arch-desktop-entry.mjs native "$install_root/scripts/arch-launcher.sh" --setup > "$application_dir/osu-pulse-setup.desktop"
if command -v update-desktop-database >/dev/null; then update-desktop-database "$application_dir" || true; fi
echo '[OK] Application menu shortcuts: osu! Pulse / osu! Pulse Setup & Update'
python3 -m venv renderer/.venv
renderer/.venv/bin/python -m pip install -r renderer/requirements.txt
python3 -m venv renderer/.venv-mania
renderer/.venv-mania/bin/python -m pip install -r renderer/mania-requirements.txt

echo '[6/7] Installing Linux danser and building Web UI'
if [[ ! -x renderer/local/danser/danser-cli ]]; then
  curl --fail --location --retry 3 https://api.github.com/repos/Wieku/danser-go/releases/latest -o work/danser-release.json
  danser_url="$(python3 - <<'PY'
import json
with open('work/danser-release.json', encoding='utf-8') as f: release = json.load(f)
assets = [a for a in release['assets'] if 'linux' in a['name'].lower() and a['name'].endswith('.zip')]
if len(assets) != 1: raise SystemExit('Could not identify Linux danser ZIP.')
print(assets[0]['browser_download_url'])
PY
)"
  curl --fail --location --retry 3 "$danser_url" -o work/danser-linux.zip
  mkdir -p renderer/local/danser
  unzip -o work/danser-linux.zip -d renderer/local/danser
  chmod +x renderer/local/danser/danser-cli
fi
npm run build
xvfb-run -a renderer/.venv-mania/bin/python renderer/mania_cli.py --source-path renderer/local/osu-mania-renderer --probe

# Match the CLI version used by the verified Windows sync script. Keep these
# tools outside application dependencies and don't copy Windows OAuth tokens.
npm install --prefix work/vercel-cli --no-audit --no-fund vercel@54.13.0
vercel_cli="$install_root/work/vercel-cli/node_modules/.bin/vercel"
if [[ ! -f .vercel/project.json && -f "$shared_root/platform/vercel-project.json" ]]; then
  mkdir -p .vercel
  install -m 600 "$shared_root/platform/vercel-project.json" .vercel/project.json
fi
if [[ -t 0 ]]; then
  "$vercel_cli" whoami >/dev/null 2>&1 || "$vercel_cli" login
  [[ -f .vercel/project.json ]] || "$vercel_cli" link
else
  echo "[INFO] For first-time Vercel access run: $vercel_cli login (and link, if the project is not linked)."
fi

echo '[7/7] Enabling services and five-minute database snapshots'
bash scripts/install-arch-autostart.sh "$shared_mount"
mkdir -p "$unit_dir/osu-pulse-db-sync.service.d"
cat > "$unit_dir/osu-pulse-db-sync.service.d/postgres.conf" <<UNIT
[Unit]
Requires=osu-pulse-postgres.service
After=osu-pulse-postgres.service
UNIT
systemctl --user daemon-reload
sudo loginctl enable-linger "$USER"
systemctl --user start osu-pulse.target
systemctl --user --no-pager status osu-pulse-bot.service osu-pulse-renderer.service osu-pulse-web.service
echo "[OK] Arch setup completed. Web UI: http://localhost:3000"
echo "USB source: $usb_app"
echo "Arch runtime: $install_root"
echo "Log: $log_path"
