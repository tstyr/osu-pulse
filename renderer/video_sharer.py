from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path
from urllib.parse import urlsplit

from .config import Settings
from .errors import ErrorCode, RenderError
from .prerequisites import DependencyState, executable_exists
from .render_options import RenderOptions


LOGGER = logging.getLogger("renderer.video-share")


def target_video_bitrate_kbps(width: int, height: int, fps: int) -> int:
    """Return a balanced H.264 bitrate target for rhythm-game footage."""
    pixel_ratio = max(1.0, (width * height) / (1920 * 1080))
    frame_ratio = max(1.0, fps / 60)
    estimate = 8_000 * (pixel_ratio ** 0.7) * (frame_ratio ** 0.5)
    rounded = round(estimate / 500) * 500
    return max(8_000, min(50_000, rounded))


class VideoSharer:
    def __init__(self, settings: Settings, dependencies: DependencyState | None = None) -> None:
        self.settings = settings
        self.dependencies = dependencies
        self._locks: dict[str, asyncio.Lock] = {}
        self._cache: dict[str, dict[str, object]] = {}

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
            return result

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
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(),
                    timeout=self.settings.video_share_timeout_seconds,
                )
            except asyncio.TimeoutError as exc:
                process.kill()
                await process.communicate()
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
                _, stderr = await asyncio.wait_for(
                    process.communicate(),
                    timeout=self.settings.video_compress_timeout_seconds,
                )
            except asyncio.TimeoutError:
                process.kill()
                await process.communicate()
                failures.append(f"{encoder}: timed out")
                continue
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
