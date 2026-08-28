from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path

from .config import Settings


def executable_exists(path: Path | None) -> bool:
    return bool(path and path.is_file())


@dataclass(slots=True)
class DependencyState:
    danser: bool = False
    mania_renderer: bool = False
    ffmpeg: bool = False
    osu_songs: bool = False
    standard_skin: bool = False
    mania_skin: bool = False
    osu_api: bool = False
    youtube_upload: bool = False
    nvenc: bool = False
    amf: bool = False
    songs_index_ready: bool = False
    songs_index_count: int = 0
    songs_index_error: str | None = None

    @property
    def status(self) -> str:
        required = (
            self.danser,
            self.mania_renderer,
            self.ffmpeg,
            self.osu_songs,
            self.standard_skin,
            self.mania_skin,
            self.osu_api,
            self.songs_index_ready,
        )
        return "online" if all(required) else "degraded"

    def public_dict(self) -> dict[str, object]:
        return {
            "danser": self.danser,
            "mania_renderer": self.mania_renderer,
            "ffmpeg": self.ffmpeg,
            "osu_songs": self.osu_songs,
            "standard_skin": self.standard_skin,
            "mania_skin": self.mania_skin,
            "osu_api": self.osu_api,
            "youtube_upload": self.youtube_upload,
            "nvenc": self.nvenc,
            "amf": self.amf,
            "songs_index_ready": self.songs_index_ready,
            "songs_index_count": self.songs_index_count,
            "songs_index_error": self.songs_index_error,
        }


async def probe_ffmpeg(path: Path | None) -> bool:
    if not executable_exists(path):
        return False
    try:
        process = await asyncio.create_subprocess_exec(
            str(path), "-hide_banner", "-version",
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        return await asyncio.wait_for(process.wait(), timeout=5) == 0
    except (OSError, asyncio.TimeoutError):
        return False


async def probe_hardware_encoder(path: Path | None, encoder: str) -> bool:
    if not executable_exists(path):
        return False
    try:
        process = await asyncio.create_subprocess_exec(
            str(path),
            "-hide_banner", "-loglevel", "error",
            # AMF rejects very small one-frame probes even when the encoder is healthy.
            "-f", "lavfi", "-i", "color=black:s=128x128:d=0.1",
            "-frames:v", "3", "-c:v", encoder, "-f", "null", "-",
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await asyncio.wait_for(process.communicate(), timeout=15)
        return process.returncode == 0 and not stderr
    except (OSError, asyncio.TimeoutError):
        return False


async def inspect_dependencies(settings: Settings) -> DependencyState:
    ffmpeg_ok = await probe_ffmpeg(settings.ffmpeg_path)
    if ffmpeg_ok:
        nvenc_ok, amf_ok = await asyncio.gather(
            probe_hardware_encoder(settings.ffmpeg_path, "h264_nvenc"),
            probe_hardware_encoder(settings.ffmpeg_path, "h264_amf"),
        )
    else:
        nvenc_ok = False
        amf_ok = False
    return DependencyState(
        danser=executable_exists(settings.danser_path),
        mania_renderer=bool(
            executable_exists(settings.mania_python_path)
            and settings.mania_entrypoint_path.is_file()
            and (settings.mania_source_path / "osu_mania_renderer_v2" / "__init__.py").is_file()
        ),
        ffmpeg=ffmpeg_ok,
        osu_songs=settings.songs_path.is_dir(),
        standard_skin=(settings.osu_skins_path / settings.standard_skin / "skin.ini").is_file(),
        mania_skin=(settings.osu_skins_path / settings.mania_skin / "skin.ini").is_file(),
        osu_api=bool(settings.osu_client_id and settings.osu_client_secret),
        youtube_upload=bool(
            settings.youtube_auto_upload
            and settings.youtube_client_id
            and settings.youtube_refresh_token
        ),
        nvenc=nvenc_ok,
        amf=amf_ok,
    )
