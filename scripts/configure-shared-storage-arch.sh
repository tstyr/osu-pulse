#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
shared_root="${1:-/mnt/osu-pulse/osu-pulse-shared}"

if [[ ! -d "$shared_root" ]]; then
  echo "[ERROR] Shared USB is not mounted at: $shared_root" >&2
  echo "Mount the exFAT partition at /mnt/osu-pulse and retry." >&2
  exit 1
fi

mkdir -p \
  "$shared_root/audio" \
  "$shared_root/osu/Songs" \
  "$shared_root/osu/Skins" \
  "$shared_root/renders/output" \
  "$shared_root/backups" \
  "$shared_root/platform"

python3 - "$project_root/.env.local" "$project_root/renderer/.env" "$shared_root" "$project_root" <<'PY'
from pathlib import Path
import sys

root_env, renderer_env, shared_root, project_root = map(Path, sys.argv[1:])

def set_values(path: Path, values: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    pending = dict(values)
    output: list[str] = []
    for line in lines:
        name = line.split("=", 1)[0] if "=" in line else ""
        if name in pending:
            value = pending.pop(name).replace("'", "\\'")
            output.append(f"{name}='{value}'")
        else:
            output.append(line)
    for name, raw in pending.items():
        value = raw.replace("'", "\\'")
        output.append(f"{name}='{value}'")
    path.write_text("\n".join(output) + "\n", encoding="utf-8")

root = str(shared_root)
set_values(root_env, {
    "OSU_PULSE_SHARED_ROOT": root,
    "BOT_AUDIO_DIR": f"{root}/audio",
})
set_values(renderer_env, {
    "OSU_PULSE_SHARED_ROOT": root,
    "OSU_SONGS_PATH": f"{root}/osu/Songs",
    "OSU_SKINS_PATH": f"{root}/osu/Skins",
    "OUTPUT_PATH": f"{root}/renders/output",
    "DANSER_PATH": f"{project_root}/renderer/local/danser/danser-cli",
    "FFMPEG_PATH": "ffmpeg",
    "MANIA_PYTHON_PATH": f"{project_root}/renderer/.venv-mania/bin/python",
})
PY

cat > "$shared_root/platform/arch.json" <<JSON
{
  "platform": "arch",
  "configuredAt": "$(date --utc --iso-8601=seconds)",
  "host": "$(hostname)",
  "projectRoot": "$project_root"
}
JSON

echo "[OK] Arch shared storage paths configured."
echo "Shared root: $shared_root"
echo "Runtime dependencies and PostgreSQL remain on the Arch system disk."
