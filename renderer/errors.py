from __future__ import annotations

from enum import Enum


class ErrorCode(str, Enum):
    INVALID_OSU_URL = "INVALID_OSU_URL"
    INVALID_SCORE_ID = "INVALID_SCORE_ID"
    SCORE_NOT_FOUND = "SCORE_NOT_FOUND"
    OSU_API_UNAVAILABLE = "OSU_API_UNAVAILABLE"
    OAUTH_FAILED = "OAUTH_FAILED"
    REPLAY_UNAVAILABLE = "REPLAY_UNAVAILABLE"
    INVALID_REPLAY = "INVALID_REPLAY"
    UNSUPPORTED_RULESET = "UNSUPPORTED_RULESET"
    BEATMAP_NOT_FOUND = "BEATMAP_NOT_FOUND"
    DANSER_NOT_FOUND = "DANSER_NOT_FOUND"
    FFMPEG_NOT_FOUND = "FFMPEG_NOT_FOUND"
    DANSER_CRASHED = "DANSER_CRASHED"
    FFMPEG_CRASHED = "FFMPEG_CRASHED"
    RENDER_TIMEOUT = "RENDER_TIMEOUT"
    RENDER_CANCELLED = "RENDER_CANCELLED"
    DISK_FULL = "DISK_FULL"
    TOO_MANY_JOBS = "TOO_MANY_JOBS"
    DUPLICATE_JOB = "DUPLICATE_JOB"
    INVALID_OPTIONS = "INVALID_OPTIONS"
    JOB_NOT_FOUND = "JOB_NOT_FOUND"
    VIDEO_NOT_READY = "VIDEO_NOT_READY"
    UNAUTHORIZED = "UNAUTHORIZED"
    INTERNAL_ERROR = "INTERNAL_ERROR"


class RenderError(Exception):
    def __init__(self, code: ErrorCode, message: str, *, http_status: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = http_status


class RenderCancelled(RenderError):
    def __init__(self) -> None:
        super().__init__(ErrorCode.RENDER_CANCELLED, "Render cancelled", http_status=409)
