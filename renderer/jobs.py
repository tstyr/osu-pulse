from __future__ import annotations

import asyncio
import json
import logging
import shutil
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .beatmap_downloader import BeatmapDownloader
from .beatmap_resolver import BeatmapResolver
from .config import Settings
from .danser_runner import DanserRunner
from .errors import ErrorCode, RenderCancelled, RenderError
from .models import JobStatus, RenderJob, ScoreMetadata, TERMINAL_STATUSES, utc_now
from .osu_api import OsuApiClient
from .render_options import RenderOptions
from .replay_parser import mods_from_bits, parse_replay, replace_beatmap_md5
from .render_policy import RenderStartPolicy
from .score_resolver import parse_score_url
from .youtube_uploader import YouTubeUploader, YouTubeUploadError
from .youtube_archive import YouTubeArchive
from .process_utils import communicate_with_timeout


LOGGER = logging.getLogger("renderer.jobs")


def overall_youtube_progress(upload_percent: int) -> int:
    clamped = max(0, min(100, upload_percent))
    return 90 + round(clamped * 0.09)


RULESET_BY_REPLAY_MODE = {0: "osu", 3: "mania"}
SUPPORTED_RULESETS = frozenset(RULESET_BY_REPLAY_MODE.values())


def _ffmpeg_text(value: str) -> str:
    return value.replace("\\", r"\\").replace("'", r"\'").replace(":", r"\:").replace("%", r"\%")


def _ffmpeg_path(value: Path) -> str:
    return value.as_posix().replace(":", r"\:").replace("'", r"\'")


def estimate_render_seconds(options: RenderOptions) -> int:
    width, height = options.size
    pixel_factor = (width * height) / (1920 * 1080)
    frame_factor = options.fps / 60
    speed = options.speed_multiplier or 1.0
    blur_factor = 1.35 if options.motion_blur else 1.0
    return max(60, round(210 * pixel_factor * frame_factor * blur_factor / speed))


class JobManager:
    def __init__(
        self,
        settings: Settings,
        osu_api: OsuApiClient,
        beatmaps: BeatmapResolver,
        runner: DanserRunner,
        beatmap_downloader: BeatmapDownloader | None = None,
        youtube_uploader: YouTubeUploader | None = None,
    ) -> None:
        self.settings = settings
        self.osu_api = osu_api
        self.beatmaps = beatmaps
        self.runner = runner
        self.beatmap_downloader = beatmap_downloader
        self.youtube_uploader = youtube_uploader
        self.youtube_archive = YouTubeArchive(settings)
        self.render_policy = RenderStartPolicy(settings)
        self.jobs: dict[str, RenderJob] = {}
        self._queue_changed = asyncio.Event()
        self._queued_ids: list[str] = []
        self._prepare_tasks: set[asyncio.Task[None]] = set()
        self._workers: list[asyncio.Task[None]] = []
        self._cleanup_task: asyncio.Task[None] | None = None
        self._youtube_retry_task: asyncio.Task[None] | None = None
        self._storage_refresh_task: asyncio.Task[None] | None = None
        self._youtube_retry_wake = asyncio.Event()
        self._last_storage_available = self.storage_snapshot()["available"]
        self._lock = asyncio.Lock()
        self._beatmap_index_lock = asyncio.Lock()
        self._stats_lock = asyncio.Lock()
        self._lifetime_stats = self._load_lifetime_stats()
        self._output_stats_lock = threading.Lock()
        self._output_stats_cached_at = 0.0
        self._output_stats_cache: tuple[int, int] | None = None

    async def start(self) -> None:
        if self._workers:
            return
        await asyncio.to_thread(self.cleanup_old_outputs)
        await asyncio.to_thread(self.cleanup_orphaned_temp)
        self._workers = [asyncio.create_task(self._worker(index), name=f"render-worker-{index}") for index in range(self.settings.max_concurrent_renders)]
        self._cleanup_task = asyncio.create_task(self._periodic_cleanup(), name="render-output-cleanup")
        self._storage_refresh_task = asyncio.create_task(self._monitor_storage(), name="render-storage-recovery")
        if self.youtube_uploader and self.youtube_uploader.configured:
            self._youtube_retry_task = asyncio.create_task(self._retry_pending_youtube(), name="youtube-upload-retry")

    async def stop(self) -> None:
        for job in self.jobs.values():
            if job.status not in TERMINAL_STATUSES:
                job.cancel_requested.set()
        tasks = [*self._workers, *self._prepare_tasks]
        if self._cleanup_task:
            tasks.append(self._cleanup_task)
        if self._youtube_retry_task:
            tasks.append(self._youtube_retry_task)
        if self._storage_refresh_task:
            tasks.append(self._storage_refresh_task)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self._workers.clear()
        self._prepare_tasks.clear()
        self._cleanup_task = None
        self._youtube_retry_task = None
        self._storage_refresh_task = None

    @property
    def queue_size(self) -> int:
        return len(self._queued_ids)

    @property
    def active_count(self) -> int:
        return sum(job.status in {JobStatus.RENDERING, JobStatus.ENCODING} for job in tuple(self.jobs.values()))

    @property
    def inflight_count(self) -> int:
        return sum(job.status not in TERMINAL_STATUSES for job in tuple(self.jobs.values()))

    def get(self, job_id: str) -> RenderJob:
        job = self.jobs.get(job_id)
        if not job:
            raise RenderError(ErrorCode.JOB_NOT_FOUND, "Job not found", http_status=404)
        return job

    async def submit_score(
        self,
        user_id: str,
        url: str,
        options: RenderOptions,
        *,
        suppress_youtube: bool = False,
        bypass_start_policy: bool = True,
    ) -> RenderJob:
        reference = parse_score_url(url)
        return await self._submit(
            user_id,
            "score_url",
            reference.canonical_url,
            options,
            score_url=reference.canonical_url,
            suppress_youtube=suppress_youtube,
            bypass_start_policy=bypass_start_policy,
        )

    async def submit_replay(
        self,
        user_id: str,
        replay: bytes,
        options: RenderOptions,
        *,
        bypass_start_policy: bool = True,
    ) -> RenderJob:
        if not replay or len(replay) > self.settings.max_replay_bytes:
            raise RenderError(ErrorCode.INVALID_REPLAY, "Replay file is empty or too large")
        info = parse_replay(replay)
        source_key = f"osr:{info.replay_md5 or info.beatmap_md5}:{len(replay)}"
        return await self._submit(
            user_id,
            "replay",
            source_key,
            options,
            uploaded_replay=replay,
            bypass_start_policy=bypass_start_policy,
        )

    async def _submit(
        self,
        user_id: str,
        input_type: str,
        source_key: str,
        options: RenderOptions,
        *,
        score_url: str | None = None,
        uploaded_replay: bytes | None = None,
        suppress_youtube: bool = False,
        bypass_start_policy: bool = True,
    ) -> RenderJob:
        if not self.storage_snapshot()["available"]:
            raise RenderError(ErrorCode.STORAGE_UNAVAILABLE, "Render storage is unavailable; reconnect the configured Songs/output drive", http_status=503)
        signature = f"{source_key}:{options.signature()}"
        async with self._lock:
            user_jobs = [job for job in self.jobs.values() if job.user_id == user_id and job.status not in TERMINAL_STATUSES]
            if len(user_jobs) >= self.settings.max_jobs_per_user:
                raise RenderError(ErrorCode.TOO_MANY_JOBS, "Too many active jobs", http_status=429)
            if any(job.source_key + ":" + job.options.signature() == signature for job in user_jobs):
                raise RenderError(ErrorCode.DUPLICATE_JOB, "An identical render job is already active", http_status=409)
            job = RenderJob(
                id=uuid.uuid4().hex,
                user_id=user_id,
                input_type=input_type,
                source_key=source_key,
                options=options,
                score_url=score_url,
                uploaded_replay=uploaded_replay,
                suppress_youtube=suppress_youtube,
                bypass_start_policy=bypass_start_policy,
                estimated_render_seconds=estimate_render_seconds(options),
            )
            self.jobs[job.id] = job
        task = asyncio.create_task(self._prepare(job), name=f"prepare-{job.id}")
        self._prepare_tasks.add(task)
        task.add_done_callback(self._prepare_tasks.discard)
        LOGGER.info("job=%s user=%s type=%s resolution=%s fps=%s created", job.id, user_id, input_type, options.resolution, options.fps)
        return job

    async def _prepare(self, job: RenderJob) -> None:
        job_dir = self._job_dir(job.id)
        try:
            job_dir.mkdir(parents=True, exist_ok=False)
            if job.input_type == "score_url":
                self._raise_if_cancelled(job)
                job.update(JobStatus.RESOLVING_SCORE, 0, "Resolving osu! score")
                reference = parse_score_url(job.score_url or "")
                job.metadata = await self.osu_api.get_score(reference)
                if job.metadata.ruleset not in SUPPORTED_RULESETS:
                    raise RenderError(ErrorCode.UNSUPPORTED_RULESET, "Only osu!standard and osu!mania are supported")
                if job.metadata.has_replay is False:
                    raise RenderError(ErrorCode.REPLAY_UNAVAILABLE, "This score has no downloadable replay", http_status=404)
                self._raise_if_cancelled(job)
                job.update(JobStatus.DOWNLOADING_REPLAY, 2, "Downloading replay from osu! API")
                replay = await self.osu_api.download_replay(reference, job.metadata.ruleset)
                if len(replay) > self.settings.max_replay_bytes:
                    raise RenderError(ErrorCode.INVALID_REPLAY, "Downloaded replay exceeds the configured limit")
            else:
                replay = job.uploaded_replay or b""

            self._raise_if_cancelled(job)
            replay_path = job_dir / "replay.osr"
            await asyncio.to_thread(replay_path.write_bytes, replay)
            job.uploaded_replay = None
            info = parse_replay(replay)
            job.replay_info = info
            replay_ruleset = RULESET_BY_REPLAY_MODE.get(info.mode)
            if replay_ruleset is None:
                raise RenderError(ErrorCode.UNSUPPORTED_RULESET, "Only osu!standard and osu!mania are supported")
            if job.metadata and job.metadata.ruleset != replay_ruleset:
                raise RenderError(ErrorCode.INVALID_REPLAY, "Score ruleset does not match the downloaded replay")
            if not job.metadata:
                job.metadata = ScoreMetadata(
                    player_name=info.player_name,
                    ruleset=replay_ruleset,
                    mods=mods_from_bits(info.mods_raw),
                    score=info.score,
                    accuracy=info.accuracy,
                    max_combo=info.max_combo,
                    miss_count=info.count_miss,
                )
            else:
                job.metadata.player_name = job.metadata.player_name or info.player_name
                job.metadata.mods = job.metadata.mods or mods_from_bits(info.mods_raw)

            job.update(JobStatus.RESOLVING_BEATMAP, 4, "Resolving beatmap")
            beatmap = await self._resolve_beatmap(job, info.beatmap_md5)
            job.beatmap_path = beatmap.path
            if beatmap.md5 != info.beatmap_md5:
                replay = replace_beatmap_md5(replay, beatmap.md5)
                await asyncio.to_thread(replay_path.write_bytes, replay)
                LOGGER.warning(
                    "job=%s replay beatmap hash %s replaced with current map hash %s for beatmap_id=%s",
                    job.id,
                    info.beatmap_md5,
                    beatmap.md5,
                    beatmap.beatmap_id,
                )
            job.metadata.beatmap_id = job.metadata.beatmap_id or beatmap.beatmap_id
            local_metadata = self.beatmaps.metadata(beatmap.path)
            job.metadata.beatmapset_id = job.metadata.beatmapset_id or local_metadata.get("beatmapset_id")  # type: ignore[assignment]
            job.metadata.artist = job.metadata.artist or local_metadata.get("artist")  # type: ignore[assignment]
            job.metadata.title = job.metadata.title or local_metadata.get("title")  # type: ignore[assignment]
            job.metadata.difficulty = job.metadata.difficulty or local_metadata.get("difficulty")  # type: ignore[assignment]
            job.metadata.mapper = job.metadata.mapper or local_metadata.get("mapper")  # type: ignore[assignment]
            metadata_path = job_dir / "metadata.json"
            await asyncio.to_thread(
                metadata_path.write_text,
                json.dumps({"job_id": job.id, "metadata": job.metadata.public_dict(), "beatmap_path": str(job.beatmap_path)}, ensure_ascii=False, indent=2),
                "utf-8",
            )
            self._raise_if_cancelled(job)
            async with self._lock:
                self._raise_if_cancelled(job)
                self._queued_ids.append(job.id)
                self._queued_ids.sort(key=lambda job_id: (-self.jobs[job_id].priority, self.jobs[job_id].created_at))
                self._refresh_queue_positions()
                job.queued_at = utc_now()
                job.update(JobStatus.QUEUED, 5, "Waiting in render queue")
                self._queue_changed.set()
            LOGGER.info("job=%s score=%s beatmap=%s mods=%s queued", job.id, job.metadata.score_id, job.metadata.beatmap_id, ",".join(job.metadata.mods))
        except RenderCancelled:
            await self._mark_cancelled(job)
        except RenderError as exc:
            await self._mark_failed(job, exc)
        except OSError as exc:
            code = ErrorCode.DISK_FULL if getattr(exc, "errno", None) == 28 else ErrorCode.INTERNAL_ERROR
            await self._mark_failed(job, RenderError(code, "Could not prepare render files"))
        except Exception:
            LOGGER.exception("job=%s unexpected preparation failure", job.id)
            await self._mark_failed(job, RenderError(ErrorCode.INTERNAL_ERROR, "Unexpected render preparation error"))

    async def _resolve_beatmap(self, job: RenderJob, checksum: str):
        assert job.metadata
        try:
            return self.beatmaps.resolve(replay_md5=checksum, beatmap_id=job.metadata.beatmap_id)
        except RenderError as initial_error:
            if initial_error.code != ErrorCode.BEATMAP_NOT_FOUND or not self.settings.auto_download_beatmaps or not self.beatmap_downloader:
                raise

        if not job.metadata.beatmapset_id:
            job.update(JobStatus.RESOLVING_BEATMAP, 4, "Looking up missing beatmap by replay checksum")
            lookup = await self.osu_api.lookup_beatmap(checksum)
            self._merge_metadata(job.metadata, lookup)
        if not job.metadata.beatmapset_id:
            raise RenderError(ErrorCode.BEATMAP_NOT_FOUND, "Beatmapset could not be identified", http_status=404)

        job.update(JobStatus.RESOLVING_BEATMAP, 4, f"Downloading beatmapset {job.metadata.beatmapset_id}")
        await self.beatmap_downloader.install(job.metadata.beatmapset_id)
        async with self._beatmap_index_lock:
            count = await asyncio.to_thread(self.beatmaps.rebuild)
            self.runner.dependencies.songs_index_ready = self.beatmaps.index.ready
            self.runner.dependencies.songs_index_count = count
            self.runner.dependencies.songs_index_error = self.beatmaps.index.last_error
        return self.beatmaps.resolve(replay_md5=checksum, beatmap_id=job.metadata.beatmap_id)

    @staticmethod
    def _merge_metadata(target: ScoreMetadata, source: ScoreMetadata) -> None:
        for name in ("beatmap_id", "beatmapset_id", "artist", "title", "difficulty", "mapper"):
            if getattr(target, name) is None:
                setattr(target, name, getattr(source, name))

    async def _worker(self, worker_index: int) -> None:
        while True:
            job = await self._next_render_job()
            job_id = job.id
            try:
                if job.cancel_requested.is_set() or job.status == JobStatus.CANCELLED:
                    if job.status != JobStatus.CANCELLED:
                        await self._mark_cancelled(job)
                    continue
                queue_seconds = (utc_now() - job.queued_at).total_seconds() if job.queued_at else 0
                LOGGER.info("job=%s worker=%s queue_time_seconds=%.3f replay_filename=replay.osr", job.id, worker_index, queue_seconds)
                replay_path = self._job_dir(job.id) / "replay.osr"
                output = await self.runner.render(job, replay_path)
                job.output_path = output
                await self._apply_watermark(job)
                job.output_size_bytes = output.stat().st_size
                job.render_finished_at = utc_now()
                await self._generate_assets(job)
                self._raise_if_cancelled(job)
                if self.youtube_uploader and self.youtube_uploader.configured and job.metadata and not job.suppress_youtube:
                    await self._upload_youtube(job)
                job.completed_at = utc_now()
                message = "Render completed"
                if job.youtube_url:
                    message += "; YouTube upload completed"
                elif job.youtube_error:
                    message += "; YouTube upload failed"
                job.update(JobStatus.COMPLETED, 100, message)
                await self._record_terminal("completed")
                LOGGER.info("job=%s worker=%s render_end duration=%s result=completed", job.id, worker_index, job.public_dict()["render_duration_seconds"])
                await self._cleanup_temp(job, keep=False)
            except RenderCancelled:
                if job:
                    await self._mark_cancelled(job)
            except RenderError as exc:
                if job:
                    await self._mark_failed(job, exc)
            except Exception:
                if job:
                    LOGGER.exception("job=%s unexpected render failure", job.id)
                    await self._mark_failed(job, RenderError(ErrorCode.INTERNAL_ERROR, "Unexpected rendering error"))
            finally:
                async with self._lock:
                    if job_id in self._queued_ids:
                        self._queued_ids.remove(job_id)
                        self._refresh_queue_positions()

    async def _next_render_job(self) -> RenderJob:
        """Reserve an eligible job without occupying a worker during schedule waits."""
        while True:
            async with self._lock:
                policy = None
                storage_ready = self.storage_snapshot()["available"]
                for job_id in tuple(self._queued_ids):
                    job = self.jobs.get(job_id)
                    if not job or job.status != JobStatus.QUEUED or job.cancel_requested.is_set():
                        self._queued_ids.remove(job_id)
                        continue
                    if not storage_ready:
                        if job.message != "Waiting for render storage to reconnect":
                            job.update(JobStatus.QUEUED, 5, "Waiting for render storage to reconnect")
                        continue
                    if not job.bypass_start_policy:
                        policy = policy or self.render_policy.snapshot()
                        if not policy.allowed:
                            if job.message != policy.reason:
                                job.update(JobStatus.QUEUED, 5, policy.reason)
                                LOGGER.info("job=%s render_start_deferred reason=%s", job.id, policy.reason)
                            continue
                    self._queued_ids.remove(job_id)
                    job.queue_position = None
                    job.estimated_wait_seconds = 0
                    self._refresh_queue_positions()
                    return job
                self._refresh_queue_positions()
                self._queue_changed.clear()
                has_deferred_jobs = bool(self._queued_ids)
            try:
                await asyncio.wait_for(self._queue_changed.wait(), timeout=15 if has_deferred_jobs else None)
            except asyncio.TimeoutError:
                continue

    async def _upload_youtube(self, job: RenderJob) -> None:
        assert self.youtube_uploader
        assert job.output_path
        assert job.metadata
        privacy = self.settings.youtube_privacy_status
        job.update(JobStatus.ENCODING, 90, f"Uploading to YouTube as {privacy}")

        def update_progress(percent: int) -> None:
            job.update(JobStatus.ENCODING, overall_youtube_progress(percent), f"Uploading to YouTube: {percent}%")

        upload = asyncio.create_task(
            self.youtube_uploader.upload(job.output_path, job.metadata, update_progress),
            name=f"youtube-upload-{job.id}",
        )
        cancelled = asyncio.create_task(job.cancel_requested.wait(), name=f"youtube-cancel-{job.id}")
        try:
            done, _ = await asyncio.wait({upload, cancelled}, return_when=asyncio.FIRST_COMPLETED)
            if cancelled in done and job.cancel_requested.is_set():
                upload.cancel()
                await asyncio.gather(upload, return_exceptions=True)
                raise RenderCancelled()
            result = await upload
            job.youtube_video_id = result.video_id
            job.youtube_url = result.url
            job.youtube_title = result.title
            job.youtube_privacy_status = result.privacy_status
            job.youtube_error = None
            # Persist success before optional API calls: a thumbnail/playlist
            # failure must never send an already published video for re-upload.
            source_size = job.output_size_bytes or job.output_path.stat().st_size
            archived = False
            try:
                await self.youtube_archive.record(job.id, result, job.metadata, source_size)
                archived = True
            except Exception:
                LOGGER.exception("job=%s YouTube upload succeeded but registry write failed; keeping local/R2 copies", job.id)
            thumbnail_uploader = getattr(self.youtube_uploader, "upload_thumbnail", None)
            if thumbnail_uploader and job.thumbnail_path and job.thumbnail_path.is_file():
                try:
                    await thumbnail_uploader(result.video_id, job.thumbnail_path)
                except Exception as exc:
                    LOGGER.warning("job=%s thumbnail upload failed: %s", job.id, exc)
            playlist_uploader = getattr(self.youtube_uploader, "add_to_playlists", None)
            if playlist_uploader:
                try:
                    playlists = await playlist_uploader(result.video_id, job.metadata)
                    if playlists:
                        LOGGER.info("job=%s added to %s YouTube playlists", job.id, len(playlists))
                except Exception as exc:
                    LOGGER.warning("job=%s playlist update failed: %s", job.id, exc)
            if archived and (self.settings.youtube_delete_after_upload or job.input_type == "composition"):
                try:
                    cleanup_errors = await self.youtube_archive.cleanup(job.id, job.output_path)
                    if cleanup_errors:
                        LOGGER.warning("job=%s post-upload cleanup incomplete: %s", job.id, " | ".join(cleanup_errors))
                except Exception:
                    LOGGER.exception("job=%s post-upload cleanup failed", job.id)
        except RenderCancelled:
            raise
        except YouTubeUploadError as exc:
            job.youtube_error = str(exc)[:500]
            await self._retain_youtube_retry(job)
            LOGGER.error("job=%s youtube_upload_failed error=%s", job.id, job.youtube_error)
        except Exception:
            job.youtube_error = "Unexpected YouTube upload failure"
            await self._retain_youtube_retry(job)
            LOGGER.exception("job=%s youtube_upload_failed unexpected_error", job.id)
        finally:
            for task in (upload, cancelled):
                if not task.done():
                    task.cancel()
            await asyncio.gather(upload, cancelled, return_exceptions=True)
            if job.thumbnail_path:
                try:
                    job.thumbnail_path.unlink(missing_ok=True)
                except OSError:
                    LOGGER.warning("job=%s thumbnail cleanup deferred because storage is unavailable", job.id)

    async def _retain_youtube_retry(self, job: RenderJob) -> None:
        if not job.metadata or not job.output_path:
            return
        source_size = job.output_size_bytes or 0
        if not source_size:
            try:
                source_size = job.output_path.stat().st_size
            except OSError:
                pass
        try:
            await self.youtube_archive.record_pending(job.id, job.metadata, source_size, job.youtube_error or "Upload failed", cleanup_after_upload=job.input_type == "composition")
        except Exception:
            LOGGER.exception("job=%s could not persist YouTube retry metadata", job.id)

    async def publish_completed_job(self, job: RenderJob) -> None:
        """Publish an externally composed completed job through the normal YouTube lifecycle."""
        if not self.youtube_uploader or not self.youtube_uploader.configured or not job.metadata or not job.output_path:
            return
        await self._generate_assets(job)
        await self._upload_youtube(job)
        message = "Render completed"
        if job.youtube_url:
            message += "; YouTube upload completed"
        elif job.youtube_error:
            message += "; YouTube upload failed"
        job.update(JobStatus.COMPLETED, 100, message)

    async def _apply_watermark(self, job: RenderJob) -> None:
        if not self.settings.video_watermark_enabled or not job.output_path or not job.metadata:
            return
        if not self.settings.ffmpeg_path or not self.settings.ffmpeg_path.is_file():
            raise RenderError(ErrorCode.INTERNAL_ERROR, "FFmpeg is required for the configured watermark")
        values = {
            "player": job.metadata.player_name or "Unknown",
            "mode": "osu!mania" if job.metadata.ruleset == "mania" else "osu!standard",
            "pp": f"{job.metadata.pp:.1f}pp" if job.metadata.pp is not None else "—pp",
            "rank": job.metadata.rank or "—",
        }
        text = self.settings.video_watermark_text
        for key, value in values.items():
            text = text.replace("{" + key + "}", value)
        text_path = self._job_dir(job.id) / "watermark.txt"
        await asyncio.to_thread(text_path.write_text, text[:120], "utf-8")
        font_path = Path("C:/Windows/Fonts/meiryo.ttc")
        position = {
            "top-left": "x=24:y=24",
            "top-right": "x=w-tw-24:y=24",
            "bottom-left": "x=24:y=h-th-24",
            "bottom-right": "x=w-tw-24:y=h-th-24",
        }.get(self.settings.video_watermark_position, "x=w-tw-24:y=h-th-24")

        def filter_path(value: Path) -> str:
            return str(value.resolve()).replace("\\", "/").replace(":", "\\:").replace("'", "\\'")

        filter_value = (
            f"drawtext=textfile='{filter_path(text_path)}':"
            + (f"fontfile='{filter_path(font_path)}':" if font_path.is_file() else "")
            + f"fontcolor=white@0.92:fontsize=h/36:borderw=2:bordercolor=black@0.75:{position}"
        )
        destination = self.settings.output_path / f"{job.id}.watermarked.mp4"
        encoder = "h264_nvenc" if self.runner.dependencies.nvenc else "h264_amf" if self.runner.dependencies.amf else "libx264"
        command = [
            str(self.settings.ffmpeg_path), "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(job.output_path), "-vf", filter_value, "-c:v", encoder,
        ]
        if encoder == "h264_nvenc":
            command.extend(["-preset", "p5", "-cq", "18", "-b:v", "0"])
        elif encoder == "h264_amf":
            command.extend(["-quality", "quality", "-rc", "cqp", "-qp_i", "18", "-qp_p", "18"])
        else:
            command.extend(["-preset", "medium", "-crf", "18"])
        command.extend(["-c:a", "copy", "-movflags", "+faststart", str(destination)])
        job.update(JobStatus.ENCODING, 86, "Applying video watermark")
        process = await asyncio.create_subprocess_exec(*command, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
        try:
            _, stderr = await communicate_with_timeout(process, timeout=self.settings.render_timeout_seconds, cancel_event=job.cancel_requested)
        except (asyncio.CancelledError, asyncio.TimeoutError, RenderCancelled):
            destination.unlink(missing_ok=True)
            raise
        if process.returncode != 0 or not destination.is_file() or destination.stat().st_size <= 0:
            destination.unlink(missing_ok=True)
            detail = stderr.decode("utf-8", errors="replace")[-300:]
            raise RenderError(ErrorCode.INTERNAL_ERROR, f"Watermark rendering failed: {detail}")
        destination.replace(job.output_path)
        LOGGER.info("job=%s watermark applied position=%s", job.id, self.settings.video_watermark_position)

    async def _generate_assets(self, job: RenderJob) -> None:
        if not job.output_path or not self.settings.ffmpeg_path or not self.settings.ffmpeg_path.is_file():
            return
        if self.youtube_uploader and self.youtube_uploader.configured:
            thumbnail = self.settings.output_path / f"{job.id}-thumbnail.jpg"
            metadata = job.metadata or ScoreMetadata()
            font_path = Path("C:/Windows/Fonts/meiryob.ttc")
            song = _ffmpeg_text(f"{metadata.artist or 'Unknown artist'} - {metadata.title or 'Unknown title'}")[:180]
            difficulty = _ffmpeg_text(f"[{metadata.difficulty or metadata.ruleset}]")[:120]
            player = _ffmpeg_text(metadata.player_name or "osu! player")[:80]
            rank = _ffmpeg_text((metadata.rank or "-").upper())[:4]
            pp = f"{metadata.pp:.1f}pp" if metadata.pp is not None else "- pp"
            accuracy = f"{metadata.accuracy * 100:.2f}%" if metadata.accuracy is not None and metadata.accuracy <= 1 else f"{metadata.accuracy:.2f}%" if metadata.accuracy is not None else "- %"
            font = f"fontfile='{_ffmpeg_path(font_path)}':" if font_path.is_file() else ""
            filters = (
                "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,"
                "eq=brightness=-0.10:saturation=1.18,"
                "drawbox=x=0:y=455:w=1280:h=265:color=black@0.72:t=fill,"
                "drawbox=x=0:y=0:w=18:h=720:color=0xf48120@1:t=fill,"
                f"drawtext={font}text='{song}':fontcolor=white:fontsize=48:x=54:y=490:borderw=2:bordercolor=black@0.65,"
                f"drawtext={font}text='{difficulty}':fontcolor=white@0.78:fontsize=27:x=56:y=558,"
                f"drawtext={font}text='{rank}':fontcolor=0xffd166:fontsize=70:x=56:y=616:borderw=2:bordercolor=black@0.7,"
                f"drawtext={font}text='{_ffmpeg_text(pp)}  ·  {_ffmpeg_text(accuracy)}':fontcolor=white:fontsize=42:x=165:y=626,"
                f"drawtext={font}text='{player}  ·  osu! Pulse':fontcolor=white@0.82:fontsize=25:x=w-tw-44:y=34"
            )
            process = await asyncio.create_subprocess_exec(
                str(self.settings.ffmpeg_path), "-hide_banner", "-loglevel", "error", "-y",
                "-ss", "00:00:05", "-i", str(job.output_path), "-frames:v", "1",
                "-vf", filters,
                "-q:v", "4", str(thumbnail),
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
            )
            try:
                _, stderr = await communicate_with_timeout(process, timeout=120, cancel_event=job.cancel_requested)
            except (asyncio.CancelledError, RenderCancelled):
                thumbnail.unlink(missing_ok=True)
                raise
            except asyncio.TimeoutError:
                stderr = b"Thumbnail generation timed out"
            if process.returncode == 0 and thumbnail.is_file() and thumbnail.stat().st_size > 0:
                job.thumbnail_path = thumbnail
            else:
                thumbnail.unlink(missing_ok=True)
                LOGGER.warning("job=%s thumbnail generation failed: %s", job.id, stderr.decode("utf-8", errors="replace")[-200:])
        if job.options.highlight:
            highlight = self.settings.output_path / f"{job.id}-highlight.mp4"
            process = await asyncio.create_subprocess_exec(
                str(self.settings.ffmpeg_path), "-hide_banner", "-loglevel", "error", "-y",
                "-sseof", "-30", "-i", str(job.output_path), "-t", "30", "-c", "copy",
                "-movflags", "+faststart", str(highlight),
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
            )
            try:
                _, stderr = await communicate_with_timeout(process, timeout=120, cancel_event=job.cancel_requested)
            except (asyncio.CancelledError, RenderCancelled):
                highlight.unlink(missing_ok=True)
                raise
            except asyncio.TimeoutError:
                stderr = b"Highlight generation timed out"
            if process.returncode == 0 and highlight.is_file() and highlight.stat().st_size > 0:
                job.highlight_path = highlight
            else:
                highlight.unlink(missing_ok=True)
                LOGGER.warning("job=%s highlight generation failed: %s", job.id, stderr.decode("utf-8", errors="replace")[-200:])

    async def cancel(self, job_id: str) -> RenderJob:
        job = self.get(job_id)
        if job.status in TERMINAL_STATUSES:
            return job
        job.cancel_requested.set()
        if job.status in {JobStatus.CREATED, JobStatus.RESOLVING_SCORE, JobStatus.DOWNLOADING_REPLAY, JobStatus.RESOLVING_BEATMAP, JobStatus.QUEUED}:
            async with self._lock:
                if job.id in self._queued_ids:
                    self._queued_ids.remove(job.id)
                    self._refresh_queue_positions()
                self._queue_changed.set()
            await self._mark_cancelled(job)
        return job

    async def prioritize(self, job_id: str) -> RenderJob:
        job = self.get(job_id)
        if job.status != JobStatus.QUEUED:
            raise RenderError(ErrorCode.INVALID_OPTIONS, "Only queued jobs can be prioritized", http_status=409)
        async with self._lock:
            if job.id not in self._queued_ids:
                raise RenderError(ErrorCode.INVALID_OPTIONS, "Job has already left the render queue", http_status=409)
            job.priority = 1
            self._queued_ids.sort(key=lambda queued_id: (-self.jobs[queued_id].priority, self.jobs[queued_id].created_at))
            self._refresh_queue_positions()
            self._queue_changed.set()
        LOGGER.info("job=%s moved to priority queue", job.id)
        return job

    async def _mark_failed(self, job: RenderJob, error: RenderError) -> None:
        if job.status == JobStatus.CANCELLED:
            return
        job.error_code = error.code.value
        job.error = error.message[:500]
        job.completed_at = utc_now()
        job.update(JobStatus.FAILED, job.progress, error.message)
        await self._record_terminal("failed")
        LOGGER.error("job=%s user=%s result=failed error_code=%s error=%s", job.id, job.user_id, error.code.value, error.message)
        await self._cleanup_temp(job, keep=self.settings.keep_failed_temp)

    async def _mark_cancelled(self, job: RenderJob) -> None:
        if job.status == JobStatus.CANCELLED:
            return
        job.error_code = ErrorCode.RENDER_CANCELLED.value
        job.error = "Render cancelled"
        job.completed_at = utc_now()
        job.update(JobStatus.CANCELLED, job.progress, "Render cancelled")
        await self._record_terminal("cancelled")
        LOGGER.info("job=%s user=%s result=cancelled", job.id, job.user_id)
        await self._cleanup_temp(job, keep=False)

    async def _cleanup_temp(self, job: RenderJob, *, keep: bool) -> None:
        if keep:
            return
        directory = self._job_dir(job.id)
        await asyncio.to_thread(shutil.rmtree, directory, True)

    def _job_dir(self, job_id: str) -> Path:
        directory = (self.settings.temp_path / job_id).resolve()
        if not directory.is_relative_to(self.settings.temp_path.resolve()):
            raise RenderError(ErrorCode.INTERNAL_ERROR, "Unsafe job directory")
        return directory

    def _refresh_queue_positions(self) -> None:
        for index, job_id in enumerate(self._queued_ids, start=1):
            job = self.jobs.get(job_id)
            if job:
                job.queue_position = index
                jobs_ahead = max(0, index - 1)
                job.estimated_wait_seconds = round(jobs_ahead / max(1, self.settings.max_concurrent_renders) * job.estimated_render_seconds)

    @staticmethod
    def _raise_if_cancelled(job: RenderJob) -> None:
        if job.cancel_requested.is_set():
            raise RenderCancelled()

    def cleanup_old_outputs(self) -> None:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=self.settings.output_retention_hours)
        pending_youtube = set(self.youtube_archive.pending_entries())
        inflight_outputs = {job.id for job in tuple(self.jobs.values()) if job.status not in TERMINAL_STATUSES}
        for output in self.settings.output_path.glob("*.mp4"):
            try:
                resolved = output.resolve()
                if not resolved.is_relative_to(self.settings.output_path.resolve()):
                    continue
                if output.stem in pending_youtube or output.stem in inflight_outputs:
                    continue
                modified = datetime.fromtimestamp(output.stat().st_mtime, timezone.utc)
                if modified < cutoff:
                    output.unlink()
            except OSError as exc:
                LOGGER.warning("Could not remove old output %s: %s", output, exc)

    def cleanup_orphaned_temp(self) -> None:
        root = self.settings.temp_path.resolve()
        for candidate in root.iterdir():
            try:
                resolved = candidate.resolve()
                if resolved.is_relative_to(root) and resolved.is_dir():
                    shutil.rmtree(resolved)
            except OSError as exc:
                LOGGER.warning("Could not remove orphaned temp directory %s: %s", candidate, exc)

    async def _periodic_cleanup(self) -> None:
        while True:
            await asyncio.sleep(3600)
            await asyncio.to_thread(self.cleanup_old_outputs)

    async def _monitor_storage(self) -> None:
        while True:
            await asyncio.sleep(5)
            try:
                await self.refresh_storage_dependencies()
            except asyncio.CancelledError:
                raise
            except Exception:
                LOGGER.exception("Storage reconnection refresh failed")

    async def refresh_storage_dependencies(self) -> None:
        dependencies = self.runner.dependencies
        previous_songs = getattr(dependencies, "osu_songs", False)
        previous_storage = self._last_storage_available

        def probe_paths() -> tuple[bool, bool, bool, bool]:
            return (
                self.settings.songs_path.is_dir(),
                (self.settings.osu_skins_path / self.settings.standard_skin / "skin.ini").is_file(),
                (self.settings.osu_skins_path / self.settings.mania_skin / "skin.ini").is_file(),
                self.settings.output_path.is_dir(),
            )

        songs, standard_skin, mania_skin, output = await asyncio.to_thread(probe_paths)
        self._last_storage_available = songs and output
        dependencies.osu_songs = songs
        dependencies.standard_skin = standard_skin
        dependencies.mania_skin = mania_skin
        if not songs:
            self.beatmaps.index.ready = False
            dependencies.songs_index_ready = False
            dependencies.songs_index_count = 0
            dependencies.songs_index_error = "Songs storage is unavailable"
            return
        if not previous_songs or not self.beatmaps.index.ready or not dependencies.songs_index_ready:
            async with self._beatmap_index_lock:
                count = await asyncio.to_thread(self.beatmaps.rebuild)
                dependencies.songs_index_ready = self.beatmaps.index.ready
                dependencies.songs_index_count = count
                dependencies.songs_index_error = self.beatmaps.index.last_error
            LOGGER.info("Songs storage recovered; indexed beatmaps=%s", count)
            self._queue_changed.set()
        if self._last_storage_available and not previous_storage:
            self._queue_changed.set()
            self._youtube_retry_wake.set()

    async def _retry_pending_youtube(self) -> None:
        # Give the API server a moment to finish startup, then recover pending
        # uploads promptly. Waiting a full minute made a successful OAuth
        # refresh appear to have had no effect.
        await asyncio.sleep(10)
        while True:
            self._youtube_retry_wake.clear()
            try:
                await self.retry_pending_youtube_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                LOGGER.exception("Pending YouTube retry worker failed")
            try:
                await asyncio.wait_for(self._youtube_retry_wake.wait(), timeout=15 * 60)
            except asyncio.TimeoutError:
                pass

    async def retry_pending_youtube_once(self) -> None:
        if not self.settings.output_path.is_dir():
            LOGGER.warning("YouTube retry paused: output storage is unavailable; preserving pending uploads")
            return
        attempted = 0
        for job_id, entry in self.youtube_archive.due_pending(limit=None):
            output = (self.settings.output_path / f"{job_id}.mp4").resolve()
            recorded = await asyncio.to_thread(self.youtube_archive.get, job_id)
            if recorded and recorded.get("video_id"):
                await self.youtube_archive.remove_pending(job_id)
                if output.is_file() and (self.settings.youtube_delete_after_upload or entry.get("cleanup_after_upload") is True):
                    await self.youtube_archive.cleanup(job_id, output)
                LOGGER.info("job=%s already uploaded; removed stale YouTube retry entry", job_id)
                continue
            if not output.is_relative_to(self.settings.output_path.resolve()) or not output.is_file():
                # A removable drive or a temporarily missing file may come back.
                # Retain its metadata, and don't let it block existing videos.
                LOGGER.warning("job=%s YouTube source unavailable; pending entry retained", job_id)
                continue
            raw_metadata = entry.get("metadata")
            if not isinstance(raw_metadata, dict):
                LOGGER.warning("job=%s invalid YouTube retry metadata; entry retained", job_id)
                continue
            fields = ScoreMetadata.__dataclass_fields__
            metadata = ScoreMetadata(**{key: value for key, value in raw_metadata.items() if key in fields})
            attempted += 1
            source_size = max(1, int(entry.get("source_size") or output.stat().st_size))
            try:
                assert self.youtube_uploader
                LOGGER.info("job=%s retrying pending YouTube upload attempt=%s", job_id, entry.get("attempts"))
                result = await self.youtube_uploader.upload(output, metadata)
                await self.youtube_archive.record(job_id, result, metadata, source_size)
                playlist_uploader = getattr(self.youtube_uploader, "add_to_playlists", None)
                if playlist_uploader:
                    try:
                        await playlist_uploader(result.video_id, metadata)
                    except Exception as exc:
                        LOGGER.warning("job=%s retry playlist update failed: %s", job_id, exc)
                if self.settings.youtube_delete_after_upload or entry.get("cleanup_after_upload") is True:
                    await self.youtube_archive.cleanup(job_id, output)
                LOGGER.info("job=%s pending YouTube upload completed video_id=%s", job_id, result.video_id)
            except YouTubeUploadError as exc:
                await self.youtube_archive.record_pending(job_id, metadata, source_size, str(exc), cleanup_after_upload=entry.get("cleanup_after_upload") is True)
                LOGGER.warning("job=%s pending YouTube retry deferred: %s", job_id, exc)
                break
            if attempted >= 10:
                break

    def storage_snapshot(self) -> dict[str, bool]:
        songs = self.settings.songs_path.is_dir()
        output = self.settings.output_path.is_dir()
        return {"available": songs and output, "songs_available": songs, "output_available": output}

    def metrics_snapshot(self) -> dict[str, object]:
        completed = int(self._lifetime_stats.get("completed", 0))
        failed = int(self._lifetime_stats.get("failed", 0))
        cancelled = int(self._lifetime_stats.get("cancelled", 0))
        # Health, bridge and Discord poll the same USB directory independently.
        # Cache only disk totals; queue/progress remain current on every call.
        with self._output_stats_lock:
            now = time.monotonic()
            if self._output_stats_cache is None or now - self._output_stats_cached_at >= 10:
                video_count = 0
                video_bytes = 0
                root = self.settings.output_path.resolve()
                for path in root.glob("*.mp4"):
                    try:
                        resolved = path.resolve()
                        if resolved.is_relative_to(root) and resolved.is_file():
                            video_count += 1
                            video_bytes += resolved.stat().st_size
                    except OSError:
                        continue
                self._output_stats_cache = video_count, video_bytes
                self._output_stats_cached_at = now
            video_count, video_bytes = self._output_stats_cache
        active = next(
            (job for job in tuple(self.jobs.values()) if job.status in {JobStatus.RENDERING, JobStatus.ENCODING}),
            None,
        )
        return {
            "queue_size": self.queue_size,
            "active_count": self.active_count,
            "active_status": active.status.value if active else "idle",
            "active_progress": active.progress if active else 0,
            "processed_total": completed + failed + cancelled,
            "completed_total": completed,
            "failed_total": failed,
            "cancelled_total": cancelled,
            "video_count": video_count,
            "video_bytes": video_bytes,
            "start_policy": self.render_policy.snapshot().public_dict(),
            "storage": self.storage_snapshot(),
            "youtube": self.youtube_archive.diagnostics(),
        }

    def _load_lifetime_stats(self) -> dict[str, int]:
        try:
            payload = json.loads(self.settings.stats_path.read_text(encoding="utf-8"))
            return {
                "completed": max(0, int(payload.get("completed", 0))),
                "failed": max(0, int(payload.get("failed", 0))),
                "cancelled": max(0, int(payload.get("cancelled", 0))),
            }
        except (OSError, ValueError, TypeError, AttributeError):
            return {"completed": 0, "failed": 0, "cancelled": 0}

    async def _record_terminal(self, status: str) -> None:
        async with self._stats_lock:
            self._lifetime_stats[status] = int(self._lifetime_stats.get(status, 0)) + 1
            await asyncio.to_thread(self._save_lifetime_stats)

    def _save_lifetime_stats(self) -> None:
        self.settings.stats_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.settings.stats_path.with_suffix(self.settings.stats_path.suffix + ".tmp")
        temporary.write_text(json.dumps(self._lifetime_stats, sort_keys=True), encoding="utf-8")
        temporary.replace(self.settings.stats_path)
