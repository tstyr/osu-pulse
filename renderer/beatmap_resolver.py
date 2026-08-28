from __future__ import annotations

import re
from pathlib import Path

from .beatmap_index import BeatmapEntry, BeatmapIndex
from .errors import ErrorCode, RenderError


class BeatmapResolver:
    def __init__(self, index: BeatmapIndex) -> None:
        self.index = index

    def resolve(self, *, replay_md5: str, beatmap_id: int | None) -> BeatmapEntry:
        entry = self.index.resolve(md5=replay_md5, beatmap_id=beatmap_id)
        if not entry:
            raise RenderError(ErrorCode.BEATMAP_NOT_FOUND, "Beatmap is not present in the local Songs directory", http_status=404)
        resolved = entry.path.resolve()
        if not resolved.is_relative_to(self.index.songs_path):
            raise RenderError(ErrorCode.BEATMAP_NOT_FOUND, "Resolved beatmap path is outside Songs directory", http_status=404)
        return BeatmapEntry(resolved, entry.beatmap_id, entry.md5)

    def rebuild(self) -> int:
        return self.index.rebuild()

    @staticmethod
    def metadata(path: Path) -> dict[str, str | int | None]:
        try:
            with path.open("rb") as handle:
                text = handle.read(256 * 1024).decode("utf-8-sig", errors="replace")
        except OSError:
            return {}

        def value(key: str) -> str | None:
            match = re.search(rf"^{re.escape(key)}\s*:\s*(.*?)\s*$", text, re.MULTILINE)
            return match.group(1).strip() if match else None

        beatmapset = value("BeatmapSetID")
        return {
            "artist": value("ArtistUnicode") or value("Artist"),
            "title": value("TitleUnicode") or value("Title"),
            "difficulty": value("Version"),
            "mapper": value("Creator"),
            "beatmapset_id": int(beatmapset) if beatmapset and beatmapset.isdigit() else None,
        }
