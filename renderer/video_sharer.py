from __future__ import annotations

import asyncio
import json
from pathlib import Path
from urllib.parse import urlsplit

from .config import Settings
from .errors import ErrorCode, RenderError


class VideoSharer:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._locks: dict[str, asyncio.Lock] = {}
        self._cache: dict[str, dict[str, object]] = {}

    async def share(self, job_id: str) -> dict[str, object]:
        cached = self._cache.get(job_id)
        if cached:
            return cached
        lock = self._locks.setdefault(job_id, asyncio.Lock())
        async with lock:
            cached = self._cache.get(job_id)
            if cached:
                return cached
            result = await self._upload(job_id)
            self._cache[job_id] = result
            return result

    async def _upload(self, job_id: str) -> dict[str, object]:
        output_root = self.settings.output_path.resolve()
        source = (output_root / f"{job_id}.mp4").resolve()
        if not source.is_relative_to(output_root) or not source.is_file():
            raise RenderError(ErrorCode.VIDEO_NOT_READY, "Video is no longer available", http_status=410)
        if not self.settings.node_path or not self.settings.node_path.is_file():
            raise RenderError(ErrorCode.VIDEO_UPLOAD_FAILED, "Node.js is unavailable for video upload", http_status=503)
        if not self.settings.video_upload_script.is_file():
            raise RenderError(ErrorCode.VIDEO_UPLOAD_FAILED, "Video uploader is not installed", http_status=503)

        process = await asyncio.create_subprocess_exec(
            str(self.settings.node_path),
            str(self.settings.video_upload_script),
            str(source),
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
        return {"url": url, "size": size, "provider": provider}
