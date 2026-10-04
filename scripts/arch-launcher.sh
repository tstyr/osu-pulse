#!/usr/bin/env bash
set -Eeuo pipefail
self="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
project_root="$(dirname "$(dirname "$self")")"
in_terminal=false
if [[ "${1:-}" == --in-terminal ]]; then in_terminal=true; shift; fi
mode="${1:---auto}"
case "$mode" in
  --auto|--start|--setup) (( $# == 0 )) || shift ;;
  --help|-h)
    echo 'Usage: bash START_OSU_PULSE_ARCH.sh [--start|--setup]'
    echo 'Default: start the installed app, or open first-time USB setup.'
    exit 0 ;;
  *) echo "[ERROR] Unknown launcher option: $mode" >&2; exit 2 ;;
esac

state_directory="${XDG_STATE_HOME:-$HOME/.local/state}/osu-pulse"
mkdir -p "$state_directory"
launcher_log="$state_directory/arch-launcher.log"
if [[ "$in_terminal" == true && -n "${OSU_PULSE_ARCH_LAUNCH_SIGNAL:-}" ]]; then
  # A waiting terminal may return the application's error code. Let its parent
  # distinguish that from failure to open a terminal, without rerunning setup.
  if [[ -d "$(dirname "$OSU_PULSE_ARCH_LAUNCH_SIGNAL")" ]]; then
    printf '%s\n' "$$" > "$OSU_PULSE_ARCH_LAUNCH_SIGNAL" || true
  fi
  unset OSU_PULSE_ARCH_LAUNCH_SIGNAL
fi

show_failure() {
  local message="$1"
  printf '[ERROR] %s\nLog: %s\n' "$message" "$launcher_log" | tee -a "$launcher_log" >&2
  if command -v zenity >/dev/null; then zenity --error --title='osu! Pulse' --text="$message
Open a terminal in the USB folder and run: bash ./START_OSU_PULSE_ARCH.sh
Log: $launcher_log" || true
  elif command -v kdialog >/dev/null; then kdialog --error "$message
Run from a terminal: bash ./START_OSU_PULSE_ARCH.sh
Log: $launcher_log" || true
  elif command -v notify-send >/dev/null; then notify-send 'osu! Pulse launcher failed' "$message. Log: $launcher_log" || true
  fi
}

# GUI file managers often provide no terminal/stdin. Open one before running
# sudo or showing errors. Bash reads the USB script even on a noexec mount.
if [[ "$in_terminal" == false && ! -t 0 && ( -n "${DISPLAY:-}" || -n "${WAYLAND_DISPLAY:-}" ) ]]; then
  launch_directory="$(mktemp -d "$state_directory/.terminal-XXXXXX")"
  launch_signal="$launch_directory/started"
  cleanup_launch_signal() {
    rm -f -- "$launch_signal"
    rmdir -- "$launch_directory" 2>/dev/null || true
  }
  trap cleanup_launch_signal EXIT
  for terminal in xdg-terminal-exec konsole gnome-terminal xfce4-terminal kitty alacritty foot xterm x-terminal-emulator; do
    command -v "$terminal" >/dev/null || continue
    case "$terminal" in
      xdg-terminal-exec) arguments=() ;;
      konsole) arguments=(--separate -e) ;;
      gnome-terminal) arguments=(--wait --) ;;
      xfce4-terminal) arguments=(--disable-server --execute) ;;
      kitty) arguments=() ;;
      *) arguments=(-e) ;;
    esac
    if OSU_PULSE_ARCH_LAUNCH_SIGNAL="$launch_signal" "$terminal" "${arguments[@]}" bash "$self" --in-terminal "$mode" "$@" >> "$launcher_log" 2>&1; then
      exit 0
    else
      terminal_code=$?
      [[ ! -f "$launch_signal" ]] || exit "$terminal_code"
    fi
    printf '[WARN] Could not launch %s\n' "$terminal" >> "$launcher_log"
  done
  show_failure 'No usable terminal emulator was found.'
  exit 1
fi

exec > >(tee -a "$launcher_log") 2>&1
on_exit() {
  local code=$?
  if (( code != 0 )); then echo "[ERROR] Launcher exited with code $code. Log: $launcher_log"; fi
  if [[ -t 0 ]]; then read -r -p 'Press Enter to close...' _ || true; fi
}
trap on_exit EXIT
[[ "$(uname -s)" == Linux ]] || { echo '[ERROR] Run this launcher on Arch Linux.'; exit 1; }
install_root="${XDG_DATA_HOME:-$HOME/.local/share}/osu-pulse"
if [[ "$mode" == --auto ]]; then
  if [[ -f "$install_root/.next/BUILD_ID" ]] && systemctl --user cat osu-pulse.target >/dev/null 2>&1; then
    mode=--start
  else mode=--setup; fi
fi

if [[ "$mode" == --start ]]; then
  echo '[START] Starting osu! Pulse. No dependency reinstall or rebuild.'
  systemctl --user start osu-pulse.target
  systemctl --user --no-pager status osu-pulse-bot.service osu-pulse-renderer.service osu-pulse-web.service osu-pulse-lavalink.service
  echo '[OK] Web UI: http://localhost:3000'
  exit 0
fi

if [[ ! -t 0 ]]; then
  show_failure 'Setup needs an interactive terminal for your sudo password.'
  exit 1
fi
setup_script=''
if [[ -f "$(dirname "$project_root")/osu-pulse-shared/shared-storage.json" ]]; then
  setup_script="$project_root/scripts/setup-usb-arch.sh"
else
  if [[ -f "$project_root/.env.local" ]]; then
    shared_root="$(sed -n 's/^OSU_PULSE_SHARED_ROOT=//p' "$project_root/.env.local" | tail -n 1 | tr -d '\r')"
    shared_root="${shared_root#\'}"; shared_root="${shared_root%\'}"
    shared_root="${shared_root#\"}"; shared_root="${shared_root%\"}"
    candidate="$(dirname "$shared_root")/osu-pulse-arch/scripts/setup-usb-arch.sh"
    [[ ! -f "$candidate" ]] || setup_script="$candidate"
  fi
  if [[ -z "$setup_script" && -f /mnt/osu-pulse/osu-pulse-arch/scripts/setup-usb-arch.sh ]]; then
    setup_script=/mnt/osu-pulse/osu-pulse-arch/scripts/setup-usb-arch.sh
  fi
fi
[[ -n "$setup_script" ]] || { echo '[ERROR] Open the USB folder and run bash ./START_OSU_PULSE_ARCH.sh --setup'; exit 1; }
# The installer has its own EXIT handler and keeps the terminal open.
export OSU_PULSE_ARCH_TERMINAL=1
trap - EXIT
exec bash "$setup_script" "$@"
