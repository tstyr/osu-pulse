from __future__ import annotations

import hashlib
import json
import logging
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any


LOGGER = logging.getLogger("renderer.beatmap_index")
BEATMAP_ID_PATTERN = re.compile(r"^BeatmapID\s*:\s*([0-9]+)\s*$", re.MULTILINE)
INDEX_VERSION = 1


@dataclass(frozen=True, slots=True)
class BeatmapEntry:
    path: Path
    beatmap_id: int | None
    md5: str


class BeatmapIndex:
    def __init__(self, songs_path: Path, cache_path: Path) -> None:
        self.songs_path = songs_path.resolve()
        self.cache_path = cache_path.resolve()
        self.by_md5: dict[str, BeatmapEntry] = {}
        self.by_id: dict[int, BeatmapEntry] = {}
        self.last_error: str | None = None
        self.ready = False

    @property
    def count(self) -> int:
        return len(self.by_md5)

    def rebuild(self) -> int:
        self.ready = False
        self.last_error = None
        if not self.songs_path.is_dir():
            self.by_md5.clear()
            self.by_id.clear()
            self.last_error = "Songs directory does not exist"
            return 0

        cached = self._load_cache()
        new_cache: dict[str, dict[str, Any]] = {}
        by_md5: dict[str, BeatmapEntry] = {}
        by_id: dict[int, BeatmapEntry] = {}

        for path in self.songs_path.rglob("*.osu"):
            try:
                resolved = path.resolve()
                if not resolved.is_relative_to(self.songs_path) or not resolved.is_file():
                    continue
                stat = resolved.stat()
                relative = resolved.relative_to(self.songs_path).as_posix()
                previous = cached.get(relative)
                if previous and previous.get("size") == stat.st_size and previous.get("mtime_ns") == stat.st_mtime_ns:
                    md5 = str(previous.get("md5", ""))
                    beatmap_id = previous.get("beatmap_id")
                else:
                    md5 = self._md5(resolved)
                    beatmap_id = self._beatmap_id(resolved)
                if not re.fullmatch(r"[0-9a-f]{32}", md5):
                    continue
                beatmap_id = int(beatmap_id) if beatmap_id is not None else None
                entry = BeatmapEntry(resolved, beatmap_id, md5)
                by_md5[md5] = entry
                if beatmap_id:
                    by_id[beatmap_id] = entry
                new_cache[relative] = {
                    "size": stat.st_size,
                    "mtime_ns": stat.st_mtime_ns,
                    "md5": md5,
                    "beatmap_id": beatmap_id,
                }
            except (OSError, ValueError) as exc:
                LOGGER.warning("Skipping unreadable beatmap %s: %s", path, exc)

        self.by_md5 = by_md5
        self.by_id = by_id
        self.ready = True
        self._save_cache(new_cache)
        return self.count

    def resolve(self, *, md5: str | None = None, beatmap_id: int | None = None) -> BeatmapEntry | None:
        if md5:
            entry = self.by_md5.get(md5.lower())
            if entry and entry.path.is_file():
                return entry
        if beatmap_id:
            entry = self.by_id.get(beatmap_id)
            if entry and entry.path.is_file():
                return entry
        return None

    def _load_cache(self) -> dict[str, dict[str, Any]]:
        try:
            payload = json.loads(self.cache_path.read_text(encoding="utf-8"))
            if payload.get("version") != INDEX_VERSION or payload.get("songs_path") != str(self.songs_path):
                return {}
            files = payload.get("files")
            return files if isinstance(files, dict) else {}
        except (OSError, ValueError, AttributeError):
            return {}

    def _save_cache(self, files: dict[str, dict[str, Any]]) -> None:
        try:
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.cache_path.with_suffix(self.cache_path.suffix + ".tmp")
            temporary.write_text(
                json.dumps({"version": INDEX_VERSION, "songs_path": str(self.songs_path), "files": files}, ensure_ascii=False),
                encoding="utf-8",
            )
            os.replace(temporary, self.cache_path)
        except OSError as exc:
            LOGGER.warning("Could not save beatmap index: %s", exc)

    @staticmethod
    def _md5(path: Path) -> str:
        digest = hashlib.md5(usedforsecurity=False)
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    @staticmethod
    def _beatmap_id(path: Path) -> int | None:
        with path.open("rb") as handle:
            header = handle.read(256 * 1024).decode("utf-8-sig", errors="replace")
        match = BEATMAP_ID_PATTERN.search(header)
        return int(match.group(1)) if match else None
