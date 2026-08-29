from __future__ import annotations

import asyncio
import base64
import logging
import os
import time
from pathlib import Path
from typing import Any

import httpx
from dotenv import set_key

from .config import Settings
from .errors import RenderError
from .jobs import JobManager
from .models import JobStatus, RenderJob, TERMINAL_STATUSES
from .prerequisites import DependencyState
from .render_options import RenderOptions
from .system_metrics import SystemMetricsCollector
from .video_sharer import VideoSharer


LOGGER = logging.getLogger("renderer.cloud")
RESTART_EXIT_CODE = 75
SYNCED_ENV_NAMES = frozenset({
    "MAX_CONCURRENT_RENDERS",
    "RENDER_TIMEOUT_SECONDS",
    "OUTPUT_RETENTION_HOURS",
    "VIDEO_ENCODER",
    "AUTO_DOWNLOAD_BEATMAPS",
    "BEATMAP_DOWNLOAD_NO_VIDEO",
    "VIDEO_COMPRESS",
    "VIDEO_COMPRESS_QUALITY",
    "VIDEO_COMPRESS_AUDIO_KBPS",
    "MANIA_SCROLL_SPEED",
    "MANIA_JUDGMENT_SCALE",
    "MANIA_SCORE_SCALE",
    "MANIA_COMBO_SCALE",
    "STD_BACKGROUND_PARALLAX",
    "STD_KEY_OVERLAY",
    "STD_KEY_OVERLAY_SCALE",
    "YOUTUBE_AUTO_UPLOAD",
    "YOUTUBE_PRIVACY_STATUS",
    "YOUTUBE_DELETE_AFTER_UPLOAD",
    "YOUTUBE_CATEGORY_ID",
    "OSU_CLIENT_ID",
    "OSU_CLIENT_SECRET",
    "YOUTUBE_CLIENT_ID",
    "YOUTUBE_CLIENT_SECRET",
    "YOUTUBE_REFRESH_TOKEN",
    "R2_ENDPOINT",
    "R2_BUCKET",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
})
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
        metrics: SystemMetricsCollector,
    ) -> None:
        self.settings = settings
        self.manager = manager
        self.dependencies = dependencies
        self.video_sharer = video_sharer
        self.metrics = metrics
        self._task: asyncio.Task[None] | None = None
        self._client: httpx.AsyncClient | None = None
        self._jobs: dict[str, asyncio.Task[None]] = {}
        self._local_jobs: dict[str, RenderJob] = {}
        self._configuration_version = settings.control_panel_config_version
        self._pending_configuration_version = settings.control_panel_config_version
        self._restart_required = False

    @property
    def enabled(self) -> bool:
        return bool(
            self.settings.cloud_url
            and self.settings.cloud_bridge_token
            and (
                self.video_sharer.configured
                or (self.manager.youtube_uploader and self.manager.youtube_uploader.configured)
            )
        )

    async def start(self) -> None:
        if not self.enabled:
            LOGGER.warning("Cloud bridge disabled: configure bridge credentials and YouTube or object storage")
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
        for local_job in tuple(self._local_jobs.values()):
            if local_job.status not in TERMINAL_STATUSES:
                await self.manager.cancel(local_job.id)
        for task in self._jobs.values():
            task.cancel()
        await asyncio.gather(*self._jobs.values(), return_exceptions=True)
        self._jobs.clear()
        self._local_jobs.clear()
        if self._client:
            await self._client.aclose()

    async def _heartbeat(self) -> dict[str, Any]:
        active_ids = list(self._jobs)
        capacity = self.settings.max_concurrent_renders
        encoder = self.settings.video_encoder
        if encoder == "auto":
            encoder = "h264_nvenc" if self.dependencies.nvenc else "h264_amf" if self.dependencies.amf else "libx264"
        metrics = await self.metrics.snapshot(self.manager)
        return {
            "rendererId": self.settings.renderer_id,
            "status": self.dependencies.status,
            "busy": len(active_ids) >= capacity,
            "activeCount": len(active_ids),
            "capacity": capacity,
            "queueSize": self.manager.queue_size,
            "activeCloudJobId": active_ids[0] if len(active_ids) == 1 else None,
            "configurationVersion": self._configuration_version,
            "restartRequired": self._restart_required,
            "dependencies": {
                **self.dependencies.public_dict(),
                **metrics,
                "local_rendering": self.manager.active_count,
                "local_inflight": self.manager.inflight_count,
                "capacity": capacity,
                "encoder": encoder,
                "cloud_bridge": True,
            },
            "version": "2.0.0",
            "videos": self.manager.youtube_archive.cloud_entries(),
        }

    async def _run(self) -> None:
        while True:
            try:
                await self._reap_jobs()
                await self._heartbeat_request()
                if self._restart_required:
                    if not self._jobs and self.manager.inflight_count == 0:
                        LOGGER.warning("Control-panel configuration is ready; restarting renderer")
                        logging.shutdown()
                        os._exit(RESTART_EXIT_CODE)
                else:
                    await self._fill_capacity()
            except asyncio.CancelledError:
                raise
            except Exception:
                LOGGER.exception("Cloud bridge iteration failed")
            await asyncio.sleep(self.settings.cloud_poll_seconds)

    async def _reap_jobs(self) -> None:
        finished = [(cloud_id, task) for cloud_id, task in self._jobs.items() if task.done()]
        for cloud_id, task in finished:
            await asyncio.gather(task, return_exceptions=True)
            self._jobs.pop(cloud_id, None)

    async def _fill_capacity(self) -> None:
        while len(self._jobs) < self.settings.max_concurrent_renders and not self._restart_required:
            claimed = await self._claim()
            if not claimed:
                return
            cloud_id = str(claimed["jobId"])
            if cloud_id in self._jobs:
                return
            self._jobs[cloud_id] = asyncio.create_task(
                self._process(claimed),
                name=f"cloud-render-{cloud_id}",
            )

    async def _heartbeat_request(self) -> None:
        assert self._client
        response = await self._client.post("/api/render/bridge/heartbeat", json=await self._heartbeat())
        response.raise_for_status()
        body = response.json()
        await self._accept_configuration(body)
        await self._accept_video_command(body)

    async def _claim(self) -> dict[str, Any] | None:
        assert self._client
        payload = await self._heartbeat()
        payload.pop("activeCloudJobId", None)
        response = await self._client.post("/api/render/bridge/claim", json=payload)
        response.raise_for_status()
        body = response.json()
        await self._accept_configuration(body)
        return body.get("job") if isinstance(body, dict) else None

    async def _accept_configuration(self, response_body: object) -> None:
        if not isinstance(response_body, dict):
            return
        configuration = response_body.get("configuration")
        if not isinstance(configuration, dict):
            return
        version = configuration.get("version")
        env = configuration.get("env")
        if not isinstance(version, int) or version <= self._pending_configuration_version or not isinstance(env, dict):
            return
        filtered: dict[str, str] = {}
        for name, value in env.items():
            if name in SYNCED_ENV_NAMES and isinstance(value, str) and len(value) <= 16_384:
                filtered[name] = value
        if not filtered:
            return
        await asyncio.to_thread(self._write_environment, filtered, version)
        self._pending_configuration_version = version
        self._restart_required = True
        LOGGER.info("Control-panel configuration v%s saved; restart deferred until idle", version)

    async def _accept_video_command(self, response_body: object) -> None:
        if not isinstance(response_body, dict):
            return
        command = response_body.get("videoCommand")
        if not isinstance(command, dict) or command.get("type") != "delete":
            return
        video_id = command.get("videoId")
        if not isinstance(video_id, str):
            return
        success = False
        error: str | None = None
        try:
            uploader = self.manager.youtube_uploader
            if not uploader:
                raise RuntimeError("YouTube uploader is unavailable")
            job_id = self.manager.youtube_archive.job_id_for_video(video_id)
            if not job_id:
                raise RuntimeError("Video is not present in the local upload registry")
            await uploader.delete_video(video_id)
            await self.manager.youtube_archive.mark_deleted(job_id)
            success = True
            LOGGER.info("youtube video deleted from control panel video_id=%s", video_id)
        except Exception as exc:
            error = str(exc)[:500]
            LOGGER.exception("youtube video delete failed video_id=%s", video_id)
        assert self._client
        response = await self._client.patch(
            f"/api/render/bridge/videos/{video_id}",
            json={"success": success, "error": error},
        )
        response.raise_for_status()

    @staticmethod
    def _write_environment(values: dict[str, str], version: int) -> None:
        env_path = Path(__file__).resolve().parent / ".env"
        env_path.touch(exist_ok=True)
        for name, value in values.items():
            set_key(env_path, name, value)
        set_key(env_path, "CONTROL_PANEL_CONFIG_VERSION", str(version))

    async def _process(self, cloud_job: dict[str, Any]) -> None:
        cloud_id = str(cloud_job["jobId"])
        local_job: RenderJob | None = None
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
            self._local_jobs[cloud_id] = local_job
            await self._monitor(cloud_id, local_job)
        except asyncio.CancelledError:
            if local_job and local_job.status not in TERMINAL_STATUSES:
                await self.manager.cancel(local_job.id)
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
            self._local_jobs.pop(cloud_id, None)

    async def _monitor(self, cloud_id: str, local_job: RenderJob) -> None:
        while local_job.status not in TERMINAL_STATUSES:
            try:
                result = await self._patch_job_state(cloud_id, local_job)
                if result.get("cancelRequested"):
                    await self.manager.cancel(local_job.id)
            except (httpx.HTTPError, OSError) as exc:
                LOGGER.warning("cloud_job=%s progress report failed: %s", cloud_id, type(exc).__name__)
            await asyncio.sleep(2.5)

        if local_job.status == JobStatus.COMPLETED and local_job.output_path:
            if local_job.youtube_url:
                await self._patch(cloud_id, {
                    "localJobId": local_job.id,
                    "status": "completed",
                    "progress": 100,
                    "message": "YouTubeへの公開投稿が完了しました",
                    "metadata": self._job_metadata(local_job),
                    "videoUrl": local_job.youtube_url,
                    "videoSize": local_job.output_size_bytes or 1,
                })
                return
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
        upload = asyncio.create_task(self._upload(job), name=f"video-upload-{cloud_id}")
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

    async def _upload(self, job: RenderJob) -> dict[str, Any]:
        if not job.output_path:
            raise RuntimeError("Local render output is unavailable for upload")
        result = await self.video_sharer.share(job.id, job.options)
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
