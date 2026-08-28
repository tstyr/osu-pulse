from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import Settings
from .models import ScoreMetadata
from .youtube_uploader import YouTubeUploadResult


LOGGER = logging.getLogger("renderer.youtube-archive")
JOB_ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")


class YouTubeArchive:
    """Persist upload success before removing replaceable video copies."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._lock = asyncio.Lock()

    def entries(self) -> dict[str, dict[str, Any]]:
        try:
            payload = json.loads(self.settings.youtube_upload_registry_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
        uploads = payload.get("uploads") if isinstance(payload, dict) else None
        return uploads if isinstance(uploads, dict) else {}

    def get(self, job_id: str) -> dict[str, Any] | None:
        value = self.entries().get(job_id)
        return value if isinstance(value, dict) else None

    async def record(
        self,
        job_id: str,
        result: YouTubeUploadResult,
        metadata: ScoreMetadata,
        source_size: int,
    ) -> None:
        if not JOB_ID_PATTERN.fullmatch(job_id):
            LOGGER.warning("Skipping YouTube registry for non-persistent job id %s", job_id)
            return
        async with self._lock:
            await asyncio.to_thread(self._record_sync, job_id, result, metadata, source_size)

    def _record_sync(
        self,
        job_id: str,
        result: YouTubeUploadResult,
        metadata: ScoreMetadata,
        source_size: int,
    ) -> None:
        uploads = self.entries()
        previous = uploads.get(job_id) if isinstance(uploads.get(job_id), dict) else {}
        uploads[job_id] = {
            **previous,
            "video_id": result.video_id,
            "url": result.url,
            "title": result.title,
            "privacy_status": result.privacy_status,
            "score_id": metadata.score_id,
            "source_size": source_size,
            "uploaded_at": datetime.now(timezone.utc).isoformat(),
        }
        self._write({"version": 1, "uploads": uploads})

    async def cleanup(self, job_id: str, output: Path) -> list[str]:
        errors: list[str] = []
        r2_deleted = False
        try:
            r2_deleted = await self._delete_r2(job_id)
        except Exception as exc:
            errors.append(f"R2: {exc}")
            LOGGER.exception("job=%s R2 cleanup failed", job_id)

        local_deleted = False
        try:
            resolved = output.resolve()
            root = self.settings.output_path.resolve()
            if not resolved.is_relative_to(root) or resolved.name != f"{job_id}.mp4":
                raise ValueError("unsafe local output path")
            await asyncio.to_thread(resolved.unlink, True)
            local_deleted = not resolved.exists()
        except Exception as exc:
            errors.append(f"local: {exc}")
            LOGGER.exception("job=%s local cleanup failed", job_id)

        async with self._lock:
            await asyncio.to_thread(self._mark_cleanup_sync, job_id, r2_deleted, local_deleted, errors)
        return errors

    async def _delete_r2(self, job_id: str) -> bool:
        configured = all(
            os.getenv(name)
            for name in ("R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY")
        )
        if not configured:
            return False
        if not self.settings.node_path or not self.settings.node_path.is_file():
            raise RuntimeError("Node.js is unavailable")
        if not self.settings.r2_delete_script.is_file():
            raise RuntimeError("R2 delete helper is unavailable")
        process = await asyncio.create_subprocess_exec(
            str(self.settings.node_path),
            str(self.settings.r2_delete_script),
            job_id,
            cwd=str(self.settings.project_root),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=120)
        if process.returncode != 0:
            detail = stderr.decode("utf-8", errors="replace").strip()
            raise RuntimeError(detail[-300:] or f"delete helper exited {process.returncode}")
        try:
            payload = json.loads(stdout.decode("utf-8"))
        except (UnicodeDecodeError, ValueError) as exc:
            raise RuntimeError("R2 delete helper returned invalid output") from exc
        return payload.get("deleted") is True

    def _mark_cleanup_sync(self, job_id: str, r2_deleted: bool, local_deleted: bool, errors: list[str]) -> None:
        uploads = self.entries()
        entry = uploads.get(job_id)
        if not isinstance(entry, dict):
            return
        entry["cleanup"] = {
            "r2_deleted": r2_deleted,
            "local_deleted": local_deleted,
            "errors": errors,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        self._write({"version": 1, "uploads": uploads})

    def _write(self, payload: dict[str, Any]) -> None:
        target = self.settings.youtube_upload_registry_path
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix(target.suffix + ".tmp")
        temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temporary, target)
