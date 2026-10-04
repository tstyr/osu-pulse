#!/usr/bin/env bash
set -Eeuo pipefail
launcher_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$launcher_root/osu-pulse-arch/scripts/arch-launcher.sh" ]]; then
  exec bash "$launcher_root/osu-pulse-arch/scripts/arch-launcher.sh" "$@"
fi
exec bash "$launcher_root/scripts/arch-launcher.sh" "$@"
