#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"
for tool in git curl sha256sum; do
  command -v "$tool" >/dev/null || { echo "[ERROR] Missing command: $tool" >&2; exit 1; }
done

mania_source="$project_root/renderer/local/osu-mania-renderer"
mania_commit=361ed13bb618b9986b72ee7b5d313a02c59fa1aa
mania_patch="$project_root/renderer/mania-hud.patch"
if [[ ! -f "$mania_source/osu_mania_renderer_v2/__init__.py" ]]; then
  # Do not overwrite an unexpected partial installation.
  [[ ! -e "$mania_source" ]] || { echo '[ERROR] Incomplete mania source exists; inspect it before reinstalling.' >&2; exit 1; }
  mkdir -p "$(dirname "$mania_source")"
  git clone --filter=blob:none --no-tags --single-branch --branch mania-v3 https://github.com/R3dWolfie/osu-mania-renderer.git "$mania_source"
  git -C "$mania_source" checkout --detach "$mania_commit"
fi
if [[ -d "$mania_source/.git" ]]; then
  [[ "$(git -C "$mania_source" rev-parse HEAD)" == "$mania_commit" ]] || { echo '[ERROR] Unexpected mania renderer revision.' >&2; exit 1; }
fi
if git -C "$mania_source" apply --check "$mania_patch" 2>/dev/null; then
  git -C "$mania_source" apply "$mania_patch"
elif ! git -C "$mania_source" apply --reverse --check "$mania_patch" 2>/dev/null; then
  echo '[ERROR] Mania source does not match the managed HUD patch.' >&2
  exit 1
fi

lavalink_jar="$project_root/lavalink/runtime/Lavalink.jar"
lavalink_hash=8cb801e591072c3689fafd71ccf571a95a4ead3cc35dfc045e157d763d89119a
if [[ ! -f "$lavalink_jar" ]] || [[ "$(sha256sum "$lavalink_jar" | cut -d ' ' -f 1)" != "$lavalink_hash" ]]; then
  mkdir -p "$(dirname "$lavalink_jar")"
  download="$(mktemp "${lavalink_jar}.download.XXXXXX")"
  trap 'rm -f -- "$download"' EXIT
  curl --fail --location --retry 3 https://github.com/lavalink-devs/Lavalink/releases/download/4.2.2/Lavalink.jar -o "$download"
  printf '%s  %s\n' "$lavalink_hash" "$download" | sha256sum --check --status
  mv -- "$download" "$lavalink_jar"
fi
echo '[OK] Pinned mania engine, HUD patch and checksum-verified Lavalink are ready.'
