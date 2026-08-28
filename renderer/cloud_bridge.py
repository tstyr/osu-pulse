from __future__ import annotations

import asyncio
import base64
import logging
import time
from pathlib import Path
from typing import Any

import httpx

from .config import Settings
from .errors import RenderError
from .jobs import JobManager
from .models import JobStatus, RenderJob, TERMINAL_STATUSES
from .prerequisites import DependencyState
from .render_options import RenderOptions
from .video_sharer import VideoSharer


LOGGER = logging.getLogger("renderer.cloud")
STATUS_MAP = {
    JobStatus.CREATED: "claimed",
    JobStatus.RESOLVING_SCORE: "resolving_score",
    JobStatus.DOWNLOADING_REPLAY: "downloading_replay",
    JobStatus.RESOLVING_BEATMAP: "resolving_beatmap",
    JobStatus.QUEUED: "claimed",
    JobStatus.RENDERING: "rendering",
    JobStatus.ENCODING: "encoding",
    JobStatus.COMPLETED: "completed",
    JobStatus.FAILED: "failed",
    JobStatus.CANCELLED: "cancelled",
}


class CloudRenderBridge:
    def __init__(
        self,
        settings: Settings,
        manager: JobManager,
        dependencies: DependencyState,
        video_sharer: VideoSharer,
    ) -> None:
        self.settings = settings
        self.manager = manager
        self.dependencies = dependencies
        self.video_sharer = video_sharer
        self._task: asyncio.Task[None] | None = None
        self._client: httpx.AsyncClient | None = None
        self._active_cloud_job_id: str | None = None
        self._active_local_job: RenderJob | None = None

    @property
    def enabled(self) -> bool:
        return bool(
            self.settings.cloud_url
            and self.settings.cloud_bridge_token
            and self.video_sharer.configured
        )

    async def start(self) -> None:
        if not self.enabled:
            LOGGER.warning("Cloud bridge disabled: configure bridge credentials and R2 or Vercel Blob storage")
            return
        self._client = httpx.AsyncClient(
            base_url=self.settings.cloud_url,
            headers={"Authorization": f"Bearer {self.settings.cloud_bridge_token}"},
            follow_redirects=False,
            timeout=httpx.Timeout(15, connect=5),
        )
        self._task = asyncio.create_task(self._run(), name="cloud-render-bridge")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
        if self._client:
            await self._client.aclose()

    def _heartbeat(self) -> dict[str, Any]:
        return {
            "rendererId": self.settings.renderer_id,
            "status": self.dependencies.status,
            "busy": self._active_cloud_job_id is not None,
            "queueSize": self.manager.queue_size,
            "activeCloudJobId": self._active_cloud_job_id,
            "dependencies": {
                **self.dependencies.public_dict(),
                "local_rendering": self.manager.active_count,
                "cloud_bridge": True,
            },
            "version": "1.1.0",
        }

    async def _run(self) -> None:
        while True:
            try:
                if not self._active_cloud_job_id:
                    claimed = await self._claim()
                    if claimed:
                        await self._process(claimed)
            except asyncio.CancelledError:
                raise
            except Exception:
                LOGGER.exception("Cloud bridge iteration failed")
            await asyncio.sleep(self.settings.cloud_poll_seconds)

    async def _heartbeat_request(self) -> None:
        assert self._client
        response = await self._client.post("/api/render/bridge/heartbeat", json=self._heartbeat())
        response.raise_for_status()

    async def _claim(self) -> dict[str, Any] | None:
        assert self._client
        payload = self._heartbeat()
        payload.pop("activeCloudJobId", None)
        response = await self._client.post("/api/render/bridge/claim", json=payload)
        response.raise_for_status()
        body = response.json()
        return body.get("job") if isinstance(body, dict) else None

    async def _process(self, cloud_job: dict[str, Any]) -> None:
        cloud_id = str(cloud_job["jobId"])
        self._active_cloud_job_id = cloud_id
        try:
            raw_options = cloud_job.get("options") or {}
            options = RenderOptions.from_values(
                raw_options.get("resolution"),
                raw_options.get("fps"),
                raw_options.get("speed"),
                raw_options.get("motionBlur"),
            )
            user_id = f"cloud-{cloud_id}"
            if cloud_job.get("inputType") == "score_url":
                local_job = await self.manager.submit_score(user_id, str(cloud_job.get("scoreUrl") or ""), options)
            else:
                encoded = cloud_job.get("replayData")
                if not isinstance(encoded, str):
                    raise ValueError("Cloud replay payload is missing")
                replay = base64.b64decode(encoded, validate=True)
                local_job = await self.manager.submit_replay(user_id, replay, options)
            self._active_local_job = local_job
            await self._monitor(cloud_id, local_job)
        except asyncio.CancelledError:
            if self._active_local_job and self._active_local_job.status not in TERMINAL_STATUSES:
                await self.manager.cancel(self._active_local_job.id)
            raise
        except RenderError as exc:
            await self._patch(cloud_id, {
                "status": "failed",
                "progress": 0,
                "message": exc.message,
                "errorCode": exc.code.value,
                "error": exc.message,
            })
        except Exception as exc:
            LOGGER.exception("cloud_job=%s failed before completion", cloud_id)
            await self._patch(cloud_id, {
                "status": "failed",
                "progress": 0,
                "message": "Local bridge failed",
                "errorCode": "CLOUD_BRIDGE_ERROR",
                "error": str(exc)[:500],
            })
        finally:
            self._active_cloud_job_id = None
            self._active_local_job = None

    async def _monitor(self, cloud_id: str, local_job: RenderJob) -> None:
        last_heartbeat = 0.0
        while local_job.status not in TERMINAL_STATUSES:
            try:
                result = await self._patch_job_state(cloud_id, local_job)
                if result.get("cancelRequested"):
                    await self.manager.cancel(local_job.id)
                if time.monotonic() - last_heartbeat >= 10:
                    await self._heartbeat_request()
                    last_heartbeat = time.monotonic()
            except (httpx.HTTPError, OSError) as exc:
                LOGGER.warning("cloud_job=%s progress report failed: %s", cloud_id, type(exc).__name__)
            await asyncio.sleep(2.5)

        if local_job.status == JobStatus.COMPLETED and local_job.output_path:
            await self._patch(cloud_id, {
                "localJobId": local_job.id,
                "status": "uploading",
                "progress": 99,
                "message": "動画を圧縮して外部ストレージへアップロード中",
                "metadata": self._job_metadata(local_job),
            })
            uploaded = await self._upload_with_lease(cloud_id, local_job)
            await self._patch(cloud_id, {
                "localJobId": local_job.id,
                "status": "completed",
                "progress": 100,
                "message": "レンダーが完了しました",
                "metadata": self._job_metadata(local_job),
                "videoUrl": uploaded["url"],
                "videoSize": uploaded["size"],
            })
        else:
            await self._patch_job_state(cloud_id, local_job)

    async def _patch_job_state(self, cloud_id: str, job: RenderJob) -> dict[str, Any]:
        return await self._patch(cloud_id, {
            "localJobId": job.id,
            "status": STATUS_MAP[job.status],
            "progress": job.progress,
            "message": job.message,
            "metadata": self._job_metadata(job),
            "errorCode": job.error_code,
            "error": job.error,
        })

    async def _patch(self, cloud_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        assert self._client
        response = await self._client.patch(
            f"/api/render/bridge/jobs/{cloud_id}",
            headers={"X-Renderer-Id": self.settings.renderer_id},
            json=payload,
        )
        response.raise_for_status()
        body = response.json()
        return body if isinstance(body, dict) else {}

    async def _upload_with_lease(self, cloud_id: str, job: RenderJob) -> dict[str, Any]:
        upload = asyncio.create_task(self._upload(job.output_path), name=f"video-upload-{cloud_id}")
        try:
            while not upload.done():
                try:
                    await asyncio.wait_for(asyncio.shield(upload), timeout=20)
                except asyncio.TimeoutError:
                    await self._patch(cloud_id, {
                        "localJobId": job.id,
                        "status": "uploading",
                        "progress": 99,
                        "message": "動画を圧縮して外部ストレージへアップロード中",
                        "metadata": self._job_metadata(job),
                    })
                    await self._heartbeat_request()
            return await upload
        finally:
            if not upload.done():
                upload.cancel()
                await asyncio.gather(upload, return_exceptions=True)

    async def _upload(self, output: Path) -> dict[str, Any]:
        local_job = self._active_local_job
        if not local_job or local_job.output_path != output:
            raise RuntimeError("Local render job is unavailable for upload")
        result = await self.video_sharer.share(local_job.id, local_job.options)
        if not isinstance(result.get("url"), str) or not isinstance(result.get("size"), int):
            raise RuntimeError("Video uploader returned an invalid response")
        return result

    @staticmethod
    def _job_metadata(job: RenderJob) -> dict[str, Any] | None:
        if not job.metadata:
            return None
        result = job.metadata.public_dict()
        result.update({
            "youtube_video_id": job.youtube_video_id,
            "youtube_url": job.youtube_url,
            "youtube_title": job.youtube_title,
            "youtube_privacy_status": job.youtube_privacy_status,
            "youtube_error": job.youtube_error,
        })
        return result
