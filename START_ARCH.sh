#!/usr/bin/env bash
set -Eeuo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ ! -t 0 && ( -n "${DISPLAY:-}" || -n "${WAYLAND_DISPLAY:-}" ) ]]; then
  exec bash "$project_root/scripts/arch-launcher.sh" --auto "$@"
fi
mkdir -p "$project_root/work"
log_path="$project_root/work/arch-setup.log"
exec > >(tee -a "$log_path") 2>&1

pause_if_interactive() {
  if [[ -t 0 ]]; then
    echo
    read -r -p "Enterキーで閉じます..." _ || true
  fi
}

on_error() {
  local code=$?
  echo
  echo "[ERROR] Archセットアップに失敗しました (line $1 / exit $code)。"
  echo "ログ: $log_path"
  pause_if_interactive
  exit "$code"
}
trap 'on_error $LINENO' ERR

find_shared_root() {
  local requested="${1:-}" mount_point candidate
  if [[ -n "$requested" ]]; then
    [[ -d "$requested/osu-pulse-shared" ]] && { printf '%s\n' "$requested/osu-pulse-shared"; return; }
    [[ -d "$requested" && "$(basename "$requested")" == "osu-pulse-shared" ]] && { printf '%s\n' "$requested"; return; }
  fi
  for candidate in \
    "/mnt/osu-pulse/osu-pulse-shared" \
    "/run/media/${USER}/OSU_PULSE/osu-pulse-shared" \
    "/media/${USER}/OSU_PULSE/osu-pulse-shared"; do
    [[ -d "$candidate" ]] && { printf '%s\n' "$candidate"; return; }
  done
  if command -v findmnt >/dev/null; then
    mount_point="$(findmnt -rn -S LABEL=OSU_PULSE -o TARGET 2>/dev/null | head -n 1 || true)"
    [[ -n "$mount_point" && -d "$mount_point/osu-pulse-shared" ]] && {
      printf '%s\n' "$mount_point/osu-pulse-shared"
      return
    }
  fi
  return 1
}

echo "=============================================="
echo " osu! Pulse Arch セットアップ"
echo "=============================================="
echo "開始: $(date --iso-8601=seconds)"

shared_root="$(find_shared_root "${1:-}")" || {
  echo "[ERROR] OSU_PULSE USBを検出できません。" >&2
  echo "ファイルマネージャーでUSBを一度開くか、次のようにマウント先を指定してください:" >&2
  echo "  bash START_ARCH.sh /run/media/$USER/OSU_PULSE" >&2
  false
}
shared_mount="$(dirname "$shared_root")"
echo "[OK] 共有ストレージ: $shared_root"

bash "$project_root/scripts/configure-shared-storage-arch.sh" "$shared_root"
bash "$project_root/scripts/install-arch-autostart.sh" "$shared_mount"
systemctl --user start osu-pulse.target

echo
echo "[OK] 自動起動とDB同期を有効にしました。"
echo "状態確認: systemctl --user status osu-pulse.target"
echo "ログ確認: journalctl --user -u 'osu-pulse-*' -n 100"
echo "設定ログ: $log_path"
pause_if_interactive
