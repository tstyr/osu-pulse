from __future__ import annotations

import asyncio
import logging
import os
import shutil
import stat
import uuid
import zipfile
from pathlib import Path, PurePosixPath

import httpx

from .config import Settings
from .errors import ErrorCode, RenderError


LOGGER = logging.getLogger("renderer.beatmap_download")
DOWNLOAD_BASE_URL = "https://mirror.hinamizawa.ai/api/v1/hinai/d"
USER_AGENT = "osu-pulse-renderer/1.2 (+https://github.com/tstyr/osu-pulse)"
MAX_ARCHIVE_FILES = 20_000


class BeatmapDownloader:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._locks: dict[int, asyncio.Lock] = {}
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(180, connect=10),
            follow_redirects=False,
            headers={"Accept": "application/octet-stream", "User-Agent": USER_AGENT},
        )

    async def close(self) -> None:
        await self._client.aclose()

    async def install(self, beatmapset_id: int) -> Path:
        if beatmapset_id <= 0:
            raise RenderError(ErrorCode.BEATMAP_DOWNLOAD_FAILED, "Beatmapset ID is invalid")
        lock = self._locks.setdefault(beatmapset_id, asyncio.Lock())
        async with lock:
            return await self._install_locked(beatmapset_id)

    async def _install_locked(self, beatmapset_id: int) -> Path:
        suffix = "n" if self.settings.beatmap_download_no_video else ""
        url = f"{DOWNLOAD_BASE_URL}/{beatmapset_id}{suffix}"
        archive = self.settings.temp_path / f"beatmap-{beatmapset_id}-{uuid.uuid4().hex}.osz"
        archive.parent.mkdir(parents=True, exist_ok=True)
        total = 0
        try:
            try:
                async with self._client.stream("GET", url) as response:
                    if response.status_code == 404:
                        raise RenderError(ErrorCode.BEATMAP_NOT_FOUND, "Beatmapset was not found by the download mirror", http_status=404)
                    if response.status_code != 200:
                        raise RenderError(
                            ErrorCode.BEATMAP_DOWNLOAD_FAILED,
                            f"Beatmap mirror returned HTTP {response.status_code}",
                            http_status=503,
                        )
                    declared = int(response.headers.get("content-length") or 0)
                    if declared > self.settings.max_beatmapset_bytes:
                        raise RenderError(ErrorCode.BEATMAP_DOWNLOAD_FAILED, "Beatmapset archive exceeds the configured size limit")
                    with archive.open("wb") as handle:
                        async for chunk in response.aiter_bytes(1024 * 1024):
                            total += len(chunk)
                            if total > self.settings.max_beatmapset_bytes:
                                raise RenderError(ErrorCode.BEATMAP_DOWNLOAD_FAILED, "Beatmapset archive exceeds the configured size limit")
                            handle.write(chunk)
            except RenderError:
                raise
            except (httpx.HTTPError, OSError) as exc:
                raise RenderError(ErrorCode.BEATMAP_DOWNLOAD_FAILED, "Beatmapset download failed", http_status=503) from exc

            with archive.open("rb") as handle:
                signature = handle.read(4)
            if total < 4 or signature != b"PK\x03\x04":
                raise RenderError(ErrorCode.BEATMAP_DOWNLOAD_FAILED, "Beatmap mirror did not return a valid .osz archive", http_status=503)
            try:
                destination = await asyncio.to_thread(self._extract_archive, archive, beatmapset_id)
            except RenderError:
                raise
            except (zipfile.BadZipFile, OSError) as exc:
                raise RenderError(
                    ErrorCode.BEATMAP_DOWNLOAD_FAILED,
                    "Beatmapset archive could not be extracted",
                    http_status=503,
                ) from exc
            LOGGER.info("beatmapset=%s downloaded_bytes=%s destination=%s", beatmapset_id, total, destination)
            return destination
        finally:
            archive.unlink(missing_ok=True)

    def _extract_archive(self, archive: Path, beatmapset_id: int) -> Path:
        songs_root = self.settings.songs_path.resolve()
        songs_root.mkdir(parents=True, exist_ok=True)
        destination = (songs_root / f"{beatmapset_id} osu-pulse-auto").resolve()
        staging = (songs_root / f".osu-pulse-{beatmapset_id}-{uuid.uuid4().hex}").resolve()
        marker_name = ".osu-pulse-managed"
        if not destination.is_relative_to(songs_root) or not staging.is_relative_to(songs_root):
            raise RenderError(ErrorCode.BEATMAP_DOWNLOAD_FAILED, "Unsafe Songs destination")

        staging.mkdir(parents=True, exist_ok=False)
        try:
            with zipfile.ZipFile(archive) as bundle:
                members = bundle.infolist()
                if len(members) > MAX_ARCHIVE_FILES:
                    raise RenderError(ErrorCode.BEATMAP_DOWNLOAD_FAILED, "Beatmapset archive contains too many files")
                maximum_uncompressed = max(self.settings.max_beatmapset_bytes * 6, 512 * 1024 * 1024)
                if sum(item.file_size for item in members) > maximum_uncompressed:
                    raise RenderError(ErrorCode.BEATMAP_DOWNLOAD_FAILED, "Beatmapset archive expands beyond the safety limit")

                for item in members:
                    normalized = item.filename.replace("\\", "/")
                    relative = PurePosixPath(normalized)
                    if relative.is_absolute() or ".." in relative.parts or not relative.parts:
                        raise RenderError(ErrorCode.BEATMAP_DOWNLOAD_FAILED, "Beatmapset archive contains an unsafe path")
                    file_type = (item.external_attr >> 16) & 0xFFFF
                    if stat.S_ISLNK(file_type):
                        raise RenderError(ErrorCode.BEATMAP_DOWNLOAD_FAILED, "Beatmapset archive contains a symbolic link")
                    target = staging.joinpath(*relative.parts).resolve()
                    if not target.is_relative_to(staging):
                        raise RenderError(ErrorCode.BEATMAP_DOWNLOAD_FAILED, "Beatmapset archive escapes the Songs directory")
                    if item.is_dir():
                        target.mkdir(parents=True, exist_ok=True)
                        continue
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with bundle.open(item) as source, target.open("wb") as output:
                        shutil.copyfileobj(source, output, length=1024 * 1024)

            if not any(staging.rglob("*.osu")):
                raise RenderError(ErrorCode.BEATMAP_DOWNLOAD_FAILED, "Beatmapset archive contains no .osu files")
            (staging / marker_name).write_text(str(beatmapset_id), encoding="utf-8")
            if destination.exists():
                marker = destination / marker_name
                if marker.is_file() and destination.is_relative_to(songs_root):
                    shutil.rmtree(destination)
                else:
                    destination = (songs_root / f"{beatmapset_id} osu-pulse-auto-{uuid.uuid4().hex[:8]}").resolve()
            os.replace(staging, destination)
            return destination
        except Exception:
            shutil.rmtree(staging, ignore_errors=True)
            raise
