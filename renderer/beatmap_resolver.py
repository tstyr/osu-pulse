from __future__ import annotations

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
