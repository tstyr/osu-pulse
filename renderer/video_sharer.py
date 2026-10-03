from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit

from .config import Settings
from .errors import ErrorCode, RenderError
from .prerequisites import DependencyState, executable_exists
from .render_options import RenderOptions
from .process_utils import communicate_with_timeout
from .youtube_archive import JOB_ID_PATTERN, YouTubeArchive


LOGGER = logging.getLogger("renderer.video-share")


def target_video_bitrate_kbps(width: int, height: int, fps: int) -> int:
    """Return a balanced H.264 bitrate target for rhythm-game footage."""
    pixel_ratio = max(1.0, (width * height) / (1920 * 1080))
    frame_ratio = max(1.0, fps / 60)
    estimate = 6_000 * (pixel_ratio ** 0.7) * (frame_ratio ** 0.5)
    rounded = round(estimate / 500) * 500
    return max(6_000, min(36_000, rounded))


class VideoSharer:
    def __init__(self, settings: Settings, dependencies: DependencyState | None = None) -> None:
        self.settings = settings
        self.dependencies = dependencies
        self._locks: dict[str, asyncio.Lock] = {}
        self._cache: dict[str, dict[str, object]] = {}
        self._registry_path = settings.log_path / "shared-videos.json"
        self._registry_lock = asyncio.Lock()
        self._cleanup_task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        self.settings.ensure_directories()
        await self.cleanup_expired()
        self._cleanup_task = asyncio.create_task(self._periodic_cleanup(), name="shared-video-cleanup")

    async def stop(self) -> None:
        if not self._cleanup_task:
            return
        self._cleanup_task.cancel()
        await asyncio.gather(self._cleanup_task, return_exceptions=True)
        self._cleanup_task = None

    @property
    def configured(self) -> bool:
        r2_ready = all(
            os.getenv(name)
            for name in ("R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY")
        )
        return bool(
            self.settings.node_path
            and self.settings.node_path.is_file()
            and self.settings.video_upload_script.is_file()
            and (r2_ready or self.settings.blob_token)
        )

    async def share(self, job_id: str, options: RenderOptions | None = None) -> dict[str, object]:
        cached = self._cache.get(job_id)
        if cached:
            return cached
        lock = self._locks.setdefault(job_id, asyncio.Lock())
        async with lock:
            cached = self._cache.get(job_id)
            if cached:
                return cached
            result = await self._upload(job_id, options)
            self._cache[job_id] = result
            await self._record_share(job_id, result)
            return result

    async def _record_share(self, job_id: str, result: dict[str, object]) -> None:
        async with self._registry_lock:
            entries = await asyncio.to_thread(self._load_registry)
            entries[job_id] = {
                "provider": result.get("provider"),
                "url": result.get("url"),
                "shared_at": datetime.now(timezone.utc).isoformat(),
            }
            await asyncio.to_thread(self._save_registry, entries)

    def _load_registry(self) -> dict[str, dict[str, object]]:
        try:
            payload = json.loads(self._registry_path.read_text("utf-8"))
        except (FileNotFoundError, OSError, ValueError):
            return {}
        return payload if isinstance(payload, dict) else {}

    def _save_registry(self, entries: dict[str, dict[str, object]]) -> None:
        self._registry_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self._registry_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(entries, ensure_ascii=False, indent=2), "utf-8")
        temporary.replace(self._registry_path)

    async def cleanup_expired(self) -> int:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=self.settings.storage_retention_hours)
        removed = 0
        pending_youtube = await asyncio.to_thread(YouTubeArchive(self.settings).pending_entries)
        async with self._registry_lock:
            entries = await asyncio.to_thread(self._load_registry)
            for job_id, entry in list(entries.items()):
                if not JOB_ID_PATTERN.fullmatch(job_id) or not isinstance(entry, dict):
                    entries.pop(job_id, None)
                    continue
                try:
                    shared_at = datetime.fromisoformat(str(entry.get("shared_at")))
                except ValueError:
                    continue
                if shared_at.tzinfo is None:
                    shared_at = shared_at.replace(tzinfo=timezone.utc)
                if shared_at > cutoff:
                    continue
                provider = entry.get("provider")
                if provider == "r2" and self.settings.node_path and self.settings.r2_delete_script.is_file():
                    process = await asyncio.create_subprocess_exec(
                        str(self.settings.node_path), str(self.settings.r2_delete_script), job_id,
                        cwd=str(self.settings.project_root), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                    )
                    _, stderr = await communicate_with_timeout(process, timeout=120)
                    if process.returncode != 0:
                        LOGGER.warning("job=%s scheduled R2 cleanup failed: %s", job_id, stderr.decode("utf-8", errors="replace")[-200:])
                        continue
                if job_id not in pending_youtube:
                    (self.settings.output_path / f"{job_id}.mp4").unlink(missing_ok=True)
                self._cache.pop(job_id, None)
                entries.pop(job_id, None)
                removed += 1
            await asyncio.to_thread(self._save_registry, entries)
        if removed:
            LOGGER.info("expired shared videos removed=%s retention_hours=%s", removed, self.settings.storage_retention_hours)
        return removed + await self._prune_expired_r2_objects()

    async def _prune_expired_r2_objects(self) -> int:
        if not self.settings.node_path or not self.settings.r2_prune_script.is_file():
            return 0
        if not all(os.getenv(name) for name in ("R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY")):
            return 0
        process = await asyncio.create_subprocess_exec(
            str(self.settings.node_path),
            str(self.settings.r2_prune_script),
            str(self.settings.storage_retention_hours),
            cwd=str(self.settings.project_root),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await communicate_with_timeout(process, timeout=120)
        if process.returncode != 0:
            LOGGER.warning("scheduled R2 orphan cleanup failed: %s", stderr.decode("utf-8", errors="replace")[-300:])
            return 0
        try:
            payload = json.loads(stdout.decode("utf-8"))
            deleted = max(0, int(payload.get("deletedCount") or 0))
            deleted_bytes = max(0, int(payload.get("deletedBytes") or 0))
        except (UnicodeDecodeError, ValueError, TypeError):
            LOGGER.warning("scheduled R2 orphan cleanup returned invalid output")
            return 0
        if deleted:
            LOGGER.info("expired R2 objects removed=%s bytes=%s retention_hours=%s", deleted, deleted_bytes, self.settings.storage_retention_hours)
        return deleted

    async def _periodic_cleanup(self) -> None:
        while True:
            await asyncio.sleep(3_600)
            try:
                await self.cleanup_expired()
            except Exception:
                LOGGER.exception("Scheduled shared video cleanup failed")

    async def _upload(self, job_id: str, options: RenderOptions | None) -> dict[str, object]:
        output_root = self.settings.output_path.resolve()
        source = (output_root / f"{job_id}.mp4").resolve()
        if not source.is_relative_to(output_root) or not source.is_file():
            raise RenderError(ErrorCode.VIDEO_NOT_READY, "Video is no longer available", http_status=410)
        if not self.settings.node_path or not self.settings.node_path.is_file():
            raise RenderError(ErrorCode.VIDEO_UPLOAD_FAILED, "Node.js is unavailable for video upload", http_status=503)
        if not self.settings.video_upload_script.is_file():
            raise RenderError(ErrorCode.VIDEO_UPLOAD_FAILED, "Video uploader is not installed", http_status=503)

        original_size = source.stat().st_size
        upload_source, compressed = await self._compress(source, job_id, options)
        try:
            process = await asyncio.create_subprocess_exec(
                str(self.settings.node_path),
                str(self.settings.video_upload_script),
                str(upload_source),
                job_id,
                cwd=str(self.settings.project_root),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                stdout, stderr = await communicate_with_timeout(
                    process,
                    timeout=self.settings.video_share_timeout_seconds,
                )
            except asyncio.TimeoutError as exc:
                raise RenderError(ErrorCode.VIDEO_UPLOAD_FAILED, "Video upload timed out", http_status=504) from exc
            if process.returncode != 0:
                detail = stderr.decode("utf-8", errors="replace").strip()
                raise RenderError(
                    ErrorCode.VIDEO_UPLOAD_FAILED,
                    f"Video upload failed: {detail[-300:]}",
                    http_status=503,
                )
            try:
                payload = json.loads(stdout.decode("utf-8"))
            except (UnicodeDecodeError, ValueError) as exc:
                raise RenderError(ErrorCode.VIDEO_UPLOAD_FAILED, "Video uploader returned invalid output", http_status=503) from exc
        finally:
            if upload_source != source:
                upload_source.unlink(missing_ok=True)
        url = payload.get("url")
        size = payload.get("size")
        provider = payload.get("provider")
        parsed = urlsplit(url) if isinstance(url, str) else None
        if (
            not parsed
            or parsed.scheme != "https"
            or parsed.username
            or parsed.password
            or not parsed.hostname
            or not isinstance(size, int)
            or size <= 0
            or provider not in {"r2", "vercel-blob"}
        ):
            raise RenderError(ErrorCode.VIDEO_UPLOAD_FAILED, "Video uploader returned invalid output", http_status=503)
        return {
            "url": url,
            "size": size,
            "original_size": original_size,
            "compressed": compressed,
            "provider": provider,
        }

    async def _compress(
        self,
        source: Path,
        job_id: str,
        options: RenderOptions | None,
    ) -> tuple[Path, bool]:
        if not self.settings.video_compress_enabled:
            return source, False
        if not executable_exists(self.settings.ffmpeg_path):
            raise RenderError(ErrorCode.VIDEO_UPLOAD_FAILED, "FFmpeg is unavailable for video compression", http_status=503)

        width, height = options.size if options else (1920, 1080)
        fps = options.fps if options else 60
        bitrate = target_video_bitrate_kbps(width, height, fps)
        destination = source.with_name(f"{job_id}.upload.mp4").resolve()
        if not destination.is_relative_to(self.settings.output_path.resolve()):
            raise RenderError(ErrorCode.VIDEO_UPLOAD_FAILED, "Unsafe compressed video path", http_status=500)

        preferred = self._preferred_encoder()
        encoders = [preferred] if preferred == "libx264" else [preferred, "libx264"]
        failures: list[str] = []
        for encoder in encoders:
            destination.unlink(missing_ok=True)
            command = self._compression_command(source, destination, encoder, bitrate)
            process = await asyncio.create_subprocess_exec(
                *command,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                _, stderr = await communicate_with_timeout(
                    process,
                    timeout=self.settings.video_compress_timeout_seconds,
                )
            except asyncio.TimeoutError:
                failures.append(f"{encoder}: timed out")
                continue
            except asyncio.CancelledError:
                destination.unlink(missing_ok=True)
                raise
            if process.returncode != 0 or not destination.is_file() or destination.stat().st_size <= 0:
                detail = stderr.decode("utf-8", errors="replace").strip()[-300:]
                failures.append(f"{encoder}: {detail or f'exit {process.returncode}'}")
                continue

            compressed_size = destination.stat().st_size
            original_size = source.stat().st_size
            if compressed_size >= original_size:
                destination.unlink(missing_ok=True)
                LOGGER.info("job=%s compression skipped because output was not smaller", job_id)
                return source, False
            LOGGER.info(
                "job=%s compressed encoder=%s original_bytes=%s compressed_bytes=%s reduction_percent=%.1f",
                job_id,
                encoder,
                original_size,
                compressed_size,
                (1 - compressed_size / original_size) * 100,
            )
            destination.replace(source)
            return source, True

        destination.unlink(missing_ok=True)
        LOGGER.error("job=%s video compression failed: %s", job_id, " | ".join(failures))
        raise RenderError(ErrorCode.VIDEO_UPLOAD_FAILED, "Video compression failed", http_status=503)

    def _preferred_encoder(self) -> str:
        if self.dependencies:
            if self.dependencies.nvenc:
                return "h264_nvenc"
            if self.dependencies.amf:
                return "h264_amf"
        if self.settings.video_encoder in {"h264_nvenc", "h264_amf", "libx264"}:
            return self.settings.video_encoder
        return "libx264"

    def _compression_command(
        self,
        source: Path,
        destination: Path,
        encoder: str,
        bitrate_kbps: int,
    ) -> list[str]:
        assert self.settings.ffmpeg_path
        quality = self.settings.video_compress_quality
        maximum = round(bitrate_kbps * 1.5)
        buffer_size = bitrate_kbps * 2
        command = [
            str(self.settings.ffmpeg_path),
            "-hide_banner",
            "-loglevel", "error",
            "-y",
            "-i", str(source),
            "-map", "0:v:0",
            "-map", "0:a?",
            "-c:v", encoder,
        ]
        if encoder == "h264_nvenc":
            command.extend([
                "-preset", "p6",
                "-tune", "hq",
                "-rc", "vbr",
                "-cq", str(quality),
                "-b:v", f"{bitrate_kbps}k",
                "-maxrate", f"{maximum}k",
                "-bufsize", f"{buffer_size}k",
            ])
        elif encoder == "h264_amf":
            command.extend([
                "-usage", "transcoding",
                "-quality", "quality",
                "-rc", "vbr_peak",
                "-b:v", f"{bitrate_kbps}k",
                "-maxrate", f"{maximum}k",
                "-bufsize", f"{buffer_size}k",
            ])
        else:
            command.extend([
                "-preset", "medium",
                "-crf", str(quality),
                "-maxrate", f"{maximum}k",
                "-bufsize", f"{buffer_size}k",
            ])
        command.extend([
            "-profile:v", "high",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-b:a", f"{self.settings.video_compress_audio_kbps}k",
            "-movflags", "+faststart",
            str(destination),
        ])
        return command
