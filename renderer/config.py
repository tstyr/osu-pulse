from __future__ import annotations

import os
import shutil
import socket
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).resolve().parent.parent
RENDERER_ROOT = Path(__file__).resolve().parent


def _load_environment() -> None:
    # Root values keep the existing Bot setup convenient; renderer/.env wins.
    load_dotenv(PROJECT_ROOT / ".env.local", override=False)
    load_dotenv(RENDERER_ROOT / ".env", override=True)


def _int_env(name: str, default: int, *, minimum: int = 1) -> int:
    raw = os.getenv(name, str(default))
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc
    if value < minimum:
        raise ValueError(f"{name} must be at least {minimum}")
    return value


def _bool_env(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _path_env(name: str, default: Path) -> Path:
    raw = os.getenv(name)
    path = Path(raw).expanduser() if raw else default
    if not path.is_absolute():
        path = PROJECT_ROOT / path
    return path.resolve()


def _executable_env(name: str, default: str) -> Path | None:
    raw = os.getenv(name, default).strip()
    if not raw:
        return None
    found = shutil.which(raw)
    if found:
        return Path(found).resolve()
    candidate = Path(raw).expanduser()
    if not candidate.is_absolute():
        candidate = PROJECT_ROOT / candidate
    return candidate.resolve()


def _cloud_url() -> str | None:
    raw = os.getenv("RENDER_CLOUD_URL", "").strip().rstrip("/")
    if not raw:
        return None
    parsed = urlsplit(raw)
    local = parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost"}
    if (parsed.scheme != "https" and not local) or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("RENDER_CLOUD_URL must be an HTTPS origin (or localhost for development)")
    if parsed.path not in {"", "/"}:
        raise ValueError("RENDER_CLOUD_URL must not contain a path")
    return raw


@dataclass(frozen=True, slots=True)
class Settings:
    host: str
    port: int
    server_token: str | None
    osu_client_id: str | None
    osu_client_secret: str | None
    danser_path: Path | None
    ffmpeg_path: Path | None
    songs_path: Path
    temp_path: Path
    output_path: Path
    log_path: Path
    beatmap_index_path: Path
    max_concurrent_renders: int
    max_jobs_per_user: int
    max_replay_bytes: int
    render_timeout_seconds: int
    output_retention_hours: int
    keep_failed_temp: bool
    video_encoder: str
    danser_settings: str
    cloud_url: str | None = None
    cloud_bridge_token: str | None = None
    blob_token: str | None = None
    node_path: Path | None = None
    cloud_poll_seconds: int = 5
    renderer_id: str = "local-renderer"
    blob_upload_script: Path = RENDERER_ROOT / "upload_blob.mjs"
    project_root: Path = PROJECT_ROOT
    auto_download_beatmaps: bool = True
    beatmap_download_no_video: bool = True
    max_beatmapset_bytes: int = 256 * 1024 * 1024
    stats_path: Path = RENDERER_ROOT / "stats.json"
    video_upload_script: Path = RENDERER_ROOT / "upload_video.mjs"
    video_share_timeout_seconds: int = 7200

    @classmethod
    def from_env(cls) -> "Settings":
        _load_environment()
        songs_default = Path(os.getenv("LOCALAPPDATA", PROJECT_ROOT)) / "osu!" / "Songs"
        encoder = os.getenv("VIDEO_ENCODER", "auto").strip().lower()
        if encoder not in {"auto", "h264_nvenc", "h264_amf", "libx264"}:
            raise ValueError("VIDEO_ENCODER must be auto, h264_nvenc, h264_amf, or libx264")
        return cls(
            # Deliberately ignore HOST so the service can never be exposed by env typo.
            host="127.0.0.1",
            port=_int_env("PORT", 8765),
            server_token=os.getenv("RENDER_SERVER_TOKEN") or None,
            osu_client_id=os.getenv("OSU_CLIENT_ID") or None,
            osu_client_secret=os.getenv("OSU_CLIENT_SECRET") or None,
            danser_path=_executable_env("DANSER_PATH", str(RENDERER_ROOT / "local" / "danser" / "danser-cli.exe")),
            ffmpeg_path=_executable_env("FFMPEG_PATH", "ffmpeg"),
            songs_path=_path_env("OSU_SONGS_PATH", songs_default),
            temp_path=_path_env("TEMP_PATH", RENDERER_ROOT / "temp"),
            output_path=_path_env("OUTPUT_PATH", RENDERER_ROOT / "output"),
            log_path=_path_env("LOG_PATH", RENDERER_ROOT / "logs"),
            beatmap_index_path=_path_env("BEATMAP_INDEX_PATH", RENDERER_ROOT / "beatmap-index.json"),
            max_concurrent_renders=_int_env("MAX_CONCURRENT_RENDERS", 1),
            max_jobs_per_user=_int_env("MAX_JOBS_PER_USER", 2),
            max_replay_bytes=_int_env("MAX_REPLAY_BYTES", 16 * 1024 * 1024),
            render_timeout_seconds=_int_env("RENDER_TIMEOUT_SECONDS", 1800),
            output_retention_hours=_int_env("OUTPUT_RETENTION_HOURS", 24),
            keep_failed_temp=_bool_env("KEEP_FAILED_TEMP", False),
            video_encoder=encoder,
            danser_settings=os.getenv("DANSER_SETTINGS", "default").strip() or "default",
            cloud_url=_cloud_url(),
            cloud_bridge_token=os.getenv("RENDER_BRIDGE_TOKEN") or None,
            blob_token=os.getenv("BLOB_READ_WRITE_TOKEN") or None,
            node_path=_executable_env("RENDER_NODE_PATH", "node"),
            cloud_poll_seconds=_int_env("RENDER_CLOUD_POLL_SECONDS", 5),
            renderer_id=(os.getenv("RENDERER_ID") or socket.gethostname() or "local-renderer")[:64],
            blob_upload_script=(RENDERER_ROOT / "upload_blob.mjs").resolve(),
            project_root=PROJECT_ROOT,
            auto_download_beatmaps=_bool_env("AUTO_DOWNLOAD_BEATMAPS", True),
            beatmap_download_no_video=_bool_env("BEATMAP_DOWNLOAD_NO_VIDEO", True),
            max_beatmapset_bytes=_int_env("MAX_BEATMAPSET_BYTES", 256 * 1024 * 1024),
            stats_path=_path_env("RENDER_STATS_PATH", RENDERER_ROOT / "stats.json"),
            video_upload_script=(RENDERER_ROOT / "upload_video.mjs").resolve(),
            video_share_timeout_seconds=_int_env("VIDEO_SHARE_TIMEOUT_SECONDS", 7200),
        )

    def ensure_directories(self) -> None:
        for path in (self.temp_path, self.output_path, self.log_path):
            path.mkdir(parents=True, exist_ok=True)


settings = Settings.from_env()
