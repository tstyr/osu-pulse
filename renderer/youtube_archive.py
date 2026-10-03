from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .config import Settings
from .models import ScoreMetadata
from .youtube_uploader import YouTubeUploadResult
from .process_utils import communicate_with_timeout


LOGGER = logging.getLogger("renderer.youtube-archive")
JOB_ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")


class YouTubeArchive:
    """Persist upload success before removing replaceable video copies."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._lock = asyncio.Lock()
        self._pending_path = settings.youtube_upload_registry_path.with_name("youtube-pending.json")

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

    def pending_entries(self) -> dict[str, dict[str, Any]]:
        try:
            payload = json.loads(self._pending_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
        pending = payload.get("pending") if isinstance(payload, dict) else None
        return pending if isinstance(pending, dict) else {}

    def due_pending(self, limit: int = 2) -> list[tuple[str, dict[str, Any]]]:
        now = datetime.now(timezone.utc)
        credential_revision = self._credential_revision()
        rows: list[tuple[str, dict[str, Any]]] = []
        for job_id, entry in self.pending_entries().items():
            if not JOB_ID_PATTERN.fullmatch(job_id) or not isinstance(entry, dict):
                continue
            try:
                next_attempt = datetime.fromisoformat(str(entry.get("next_attempt_at")))
            except ValueError:
                next_attempt = now
            if next_attempt.tzinfo is None:
                next_attempt = next_attempt.replace(tzinfo=timezone.utc)
            stored_revision = entry.get("credential_revision")
            credentials_changed = bool(
                credential_revision
                and isinstance(stored_revision, str)
                and stored_revision
                and stored_revision != credential_revision
            )
            if next_attempt <= now or credentials_changed:
                rows.append((job_id, entry))
        rows.sort(key=lambda item: str(item[1].get("next_attempt_at") or ""))
        return rows[:max(1, limit)]

    async def record_pending(
        self,
        job_id: str,
        metadata: ScoreMetadata,
        source_size: int,
        error: str,
        *,
        cleanup_after_upload: bool = False,
    ) -> None:
        if not JOB_ID_PATTERN.fullmatch(job_id):
            return
        async with self._lock:
            await asyncio.to_thread(self._record_pending_sync, job_id, metadata, source_size, error, cleanup_after_upload)

    def _record_pending_sync(
        self,
        job_id: str,
        metadata: ScoreMetadata,
        source_size: int,
        error: str,
        cleanup_after_upload: bool,
    ) -> None:
        pending = self.pending_entries()
        previous = pending.get(job_id) if isinstance(pending.get(job_id), dict) else {}
        attempts = max(0, int(previous.get("attempts") or 0)) + 1
        limited = "exceeded the number of videos" in error.lower()
        credentials_revoked = "invalid_grant" in error.lower()
        delay = (
            timedelta(hours=24)
            if credentials_revoked
            else timedelta(hours=6)
            if limited
            else timedelta(minutes=min(360, 15 * (2 ** min(attempts - 1, 5))))
        )
        now = datetime.now(timezone.utc)
        pending[job_id] = {
            "metadata": metadata.public_dict(),
            "source_size": max(0, int(source_size)),
            "attempts": attempts,
            "last_error": error[:500],
            "cleanup_after_upload": bool(cleanup_after_upload or previous.get("cleanup_after_upload")),
            "queued_at": previous.get("queued_at") or now.isoformat(),
            "last_attempt_at": now.isoformat(),
            "next_attempt_at": (now + delay).isoformat(),
            "credential_revision": self._credential_revision(),
        }
        self._write_pending(pending)

    def _credential_revision(self) -> str | None:
        token = getattr(self.settings, "youtube_refresh_token", None)
        if not isinstance(token, str) or not token:
            return None
        return hashlib.sha256(token.encode("utf-8")).hexdigest()[:16]

    async def remove_pending(self, job_id: str) -> None:
        async with self._lock:
            await asyncio.to_thread(self._remove_pending_sync, job_id)

    def _remove_pending_sync(self, job_id: str) -> None:
        pending = self.pending_entries()
        if pending.pop(job_id, None) is not None:
            self._write_pending(pending)

    def _write_pending(self, pending: dict[str, dict[str, Any]]) -> None:
        self._pending_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self._pending_path.with_suffix(self._pending_path.suffix + ".tmp")
        temporary.write_text(json.dumps({"version": 1, "pending": pending}, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temporary, self._pending_path)

    def cloud_entries(self, limit: int = 200) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for job_id, entry in self.entries().items():
            if not isinstance(entry, dict):
                continue
            video_id = entry.get("video_id")
            uploaded_at = entry.get("uploaded_at")
            if not isinstance(video_id, str) or not isinstance(uploaded_at, str):
                continue
            rows.append({
                "videoId": video_id,
                "jobId": job_id,
                "url": entry.get("url") or f"https://youtu.be/{video_id}",
                "title": entry.get("title") or "osu! replay",
                "privacyStatus": entry.get("privacy_status") or "public",
                "scoreId": entry.get("score_id"),
                "sourceSize": max(0, int(entry.get("source_size") or 0)),
                "uploadedAt": uploaded_at,
                "cleanup": entry.get("cleanup") if isinstance(entry.get("cleanup"), dict) else None,
                "deletedAt": entry.get("deleted_at") if isinstance(entry.get("deleted_at"), str) else None,
            })
        rows.sort(key=lambda row: row["uploadedAt"], reverse=True)
        return rows[:limit]

    def job_id_for_video(self, video_id: str) -> str | None:
        for job_id, entry in self.entries().items():
            if isinstance(entry, dict) and entry.get("video_id") == video_id:
                return job_id
        return None

    async def mark_deleted(self, job_id: str) -> None:
        async with self._lock:
            await asyncio.to_thread(self._mark_deleted_sync, job_id)

    def _mark_deleted_sync(self, job_id: str) -> None:
        uploads = self.entries()
        entry = uploads.get(job_id)
        if not isinstance(entry, dict):
            return
        entry["deleted_at"] = datetime.now(timezone.utc).isoformat()
        self._write({"version": 1, "uploads": uploads})

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
        self._remove_pending_sync(job_id)

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
        stdout, stderr = await communicate_with_timeout(process, timeout=120)
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
