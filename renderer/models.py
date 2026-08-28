from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any

from .render_options import RenderOptions


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class JobStatus(str, Enum):
    CREATED = "created"
    RESOLVING_SCORE = "resolving_score"
    DOWNLOADING_REPLAY = "downloading_replay"
    RESOLVING_BEATMAP = "resolving_beatmap"
    QUEUED = "queued"
    RENDERING = "rendering"
    ENCODING = "encoding"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


TERMINAL_STATUSES = {JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED}


@dataclass(slots=True)
class ReplayInfo:
    mode: int
    game_version: int
    beatmap_md5: str
    player_name: str
    replay_md5: str
    count_300: int
    count_100: int
    count_50: int
    count_geki: int
    count_katu: int
    count_miss: int
    score: int
    max_combo: int
    perfect: bool
    mods_raw: int
    timestamp_ticks: int

    @property
    def accuracy(self) -> float | None:
        if self.mode == 3:
            total = self.count_geki + self.count_300 + self.count_katu + self.count_100 + self.count_50 + self.count_miss
            if total <= 0:
                return None
            weighted = 300 * (self.count_geki + self.count_300) + 200 * self.count_katu + 100 * self.count_100 + 50 * self.count_50
            return weighted / (300 * total)
        total = self.count_300 + self.count_100 + self.count_50 + self.count_miss
        if total <= 0:
            return None
        return (300 * self.count_300 + 100 * self.count_100 + 50 * self.count_50) / (300 * total)


@dataclass(slots=True)
class ScoreMetadata:
    score_id: int | None = None
    player_name: str | None = None
    user_id: int | None = None
    beatmap_id: int | None = None
    beatmapset_id: int | None = None
    artist: str | None = None
    title: str | None = None
    difficulty: str | None = None
    mapper: str | None = None
    ruleset: str = "osu"
    mods: list[str] = field(default_factory=list)
    score: int | None = None
    accuracy: float | None = None
    max_combo: int | None = None
    miss_count: int | None = None
    ended_at: str | None = None
    has_replay: bool | None = None

    def public_dict(self) -> dict[str, Any]:
        return {
            "score_id": self.score_id,
            "player_name": self.player_name,
            "user_id": self.user_id,
            "beatmap_id": self.beatmap_id,
            "beatmapset_id": self.beatmapset_id,
            "artist": self.artist,
            "title": self.title,
            "difficulty": self.difficulty,
            "mapper": self.mapper,
            "ruleset": self.ruleset,
            "mods": self.mods,
            "score": self.score,
            "accuracy": self.accuracy,
            "max_combo": self.max_combo,
            "miss_count": self.miss_count,
            "ended_at": self.ended_at,
            "has_replay": self.has_replay,
        }


@dataclass(slots=True)
class RenderJob:
    id: str
    user_id: str
    input_type: str
    source_key: str
    options: RenderOptions
    score_url: str | None = None
    uploaded_replay: bytes | None = None
    status: JobStatus = JobStatus.CREATED
    progress: int = 0
    message: str = "Job created"
    queue_position: int | None = None
    metadata: ScoreMetadata | None = None
    replay_info: ReplayInfo | None = None
    beatmap_path: Path | None = None
    output_path: Path | None = None
    error_code: str | None = None
    error: str | None = None
    created_at: datetime = field(default_factory=utc_now)
    updated_at: datetime = field(default_factory=utc_now)
    queued_at: datetime | None = None
    render_started_at: datetime | None = None
    completed_at: datetime | None = None
    process: asyncio.subprocess.Process | None = field(default=None, repr=False)
    cancel_requested: asyncio.Event = field(default_factory=asyncio.Event, repr=False)

    def update(self, status: JobStatus, progress: int, message: str) -> None:
        self.status = status
        self.progress = max(0, min(100, progress))
        self.message = message[:500]
        self.updated_at = utc_now()

    def public_dict(self) -> dict[str, Any]:
        render_duration = None
        if self.render_started_at:
            end = self.completed_at or utc_now()
            render_duration = round((end - self.render_started_at).total_seconds(), 2)
        return {
            "job_id": self.id,
            "status": self.status.value,
            "progress": self.progress,
            "message": self.message,
            "queue_position": self.queue_position,
            "metadata": self.metadata.public_dict() if self.metadata else None,
            "options": {
                "resolution": self.options.resolution,
                "fps": self.options.fps,
                "speed": self.options.speed,
                "motion_blur": self.options.motion_blur,
            },
            "error_code": self.error_code,
            "error": self.error,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "render_duration_seconds": render_duration,
        }
