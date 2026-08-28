from __future__ import annotations

import asyncio
import json
import logging
import shutil
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
from .replay_parser import mods_from_bits, parse_replay
from .score_resolver import parse_score_url
from .youtube_uploader import YouTubeUploader, YouTubeUploadError


LOGGER = logging.getLogger("renderer.jobs")
RULESET_BY_REPLAY_MODE = {0: "osu", 3: "mania"}
SUPPORTED_RULESETS = frozenset(RULESET_BY_REPLAY_MODE.values())


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
        self.jobs: dict[str, RenderJob] = {}
        self._render_queue: asyncio.Queue[str] = asyncio.Queue()
        self._queued_ids: list[str] = []
        self._prepare_tasks: set[asyncio.Task[None]] = set()
        self._workers: list[asyncio.Task[None]] = []
        self._cleanup_task: asyncio.Task[None] | None = None
        self._lock = asyncio.Lock()
        self._beatmap_index_lock = asyncio.Lock()
        self._stats_lock = asyncio.Lock()
        self._lifetime_stats = self._load_lifetime_stats()

    async def start(self) -> None:
        await asyncio.to_thread(self.cleanup_old_outputs)
        await asyncio.to_thread(self.cleanup_orphaned_temp)
        self._workers = [asyncio.create_task(self._worker(index), name=f"render-worker-{index}") for index in range(self.settings.max_concurrent_renders)]
        self._cleanup_task = asyncio.create_task(self._periodic_cleanup(), name="render-output-cleanup")

    async def stop(self) -> None:
        for job in self.jobs.values():
            if job.status not in TERMINAL_STATUSES:
                job.cancel_requested.set()
        tasks = [*self._workers, *self._prepare_tasks]
        if self._cleanup_task:
            tasks.append(self._cleanup_task)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    @property
    def queue_size(self) -> int:
        return len(self._queued_ids)

    @property
    def active_count(self) -> int:
        return sum(job.status in {JobStatus.RENDERING, JobStatus.ENCODING} for job in self.jobs.values())

    def get(self, job_id: str) -> RenderJob:
        job = self.jobs.get(job_id)
        if not job:
            raise RenderError(ErrorCode.JOB_NOT_FOUND, "Job not found", http_status=404)
        return job

    async def submit_score(self, user_id: str, url: str, options: RenderOptions) -> RenderJob:
        reference = parse_score_url(url)
        return await self._submit(user_id, "score_url", reference.canonical_url, options, score_url=reference.canonical_url)

    async def submit_replay(self, user_id: str, replay: bytes, options: RenderOptions) -> RenderJob:
        if not replay or len(replay) > self.settings.max_replay_bytes:
            raise RenderError(ErrorCode.INVALID_REPLAY, "Replay file is empty or too large")
        info = parse_replay(replay)
        source_key = f"osr:{info.replay_md5 or info.beatmap_md5}:{len(replay)}"
        return await self._submit(user_id, "replay", source_key, options, uploaded_replay=replay)

    async def _submit(
        self,
        user_id: str,
        input_type: str,
        source_key: str,
        options: RenderOptions,
        *,
        score_url: str | None = None,
        uploaded_replay: bytes | None = None,
    ) -> RenderJob:
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
                self._queued_ids.append(job.id)
                self._refresh_queue_positions()
                job.queued_at = utc_now()
                job.update(JobStatus.QUEUED, 5, "Waiting in render queue")
                await self._render_queue.put(job.id)
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
            job_id = await self._render_queue.get()
            job = self.jobs.get(job_id)
            try:
                async with self._lock:
                    if job_id in self._queued_ids:
                        self._queued_ids.remove(job_id)
                    self._refresh_queue_positions()
                if not job or job.cancel_requested.is_set() or job.status == JobStatus.CANCELLED:
                    if job and job.status != JobStatus.CANCELLED:
                        await self._mark_cancelled(job)
                    continue
                queue_seconds = (utc_now() - job.queued_at).total_seconds() if job.queued_at else 0
                LOGGER.info("job=%s worker=%s queue_time_seconds=%.3f replay_filename=replay.osr", job.id, worker_index, queue_seconds)
                replay_path = self._job_dir(job.id) / "replay.osr"
                output = await self.runner.render(job, replay_path)
                job.output_path = output
                job.render_finished_at = utc_now()
                if self.youtube_uploader and self.youtube_uploader.configured and job.metadata:
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
                self._render_queue.task_done()

    async def _upload_youtube(self, job: RenderJob) -> None:
        assert self.youtube_uploader
        assert job.output_path
        assert job.metadata
        job.update(JobStatus.ENCODING, 99, "Uploading to YouTube as unlisted")

        def update_progress(percent: int) -> None:
            job.update(JobStatus.ENCODING, 99, f"Uploading to YouTube: {percent}%")

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
        except YouTubeUploadError as exc:
            job.youtube_error = str(exc)[:500]
            LOGGER.error("job=%s youtube_upload_failed error=%s", job.id, job.youtube_error)
        except Exception:
            job.youtube_error = "Unexpected YouTube upload failure"
            LOGGER.exception("job=%s youtube_upload_failed unexpected_error", job.id)
        finally:
            if not cancelled.done():
                cancelled.cancel()
            await asyncio.gather(cancelled, return_exceptions=True)

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
            await self._mark_cancelled(job)
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

    @staticmethod
    def _raise_if_cancelled(job: RenderJob) -> None:
        if job.cancel_requested.is_set():
            raise RenderCancelled()

    def cleanup_old_outputs(self) -> None:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=self.settings.output_retention_hours)
        for output in self.settings.output_path.glob("*.mp4"):
            try:
                resolved = output.resolve()
                if not resolved.is_relative_to(self.settings.output_path.resolve()):
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

    def metrics_snapshot(self) -> dict[str, object]:
        completed = int(self._lifetime_stats.get("completed", 0))
        failed = int(self._lifetime_stats.get("failed", 0))
        cancelled = int(self._lifetime_stats.get("cancelled", 0))
        video_count = 0
        video_bytes = 0
        for path in self.settings.output_path.glob("*.mp4"):
            try:
                resolved = path.resolve()
                if resolved.is_relative_to(self.settings.output_path.resolve()) and resolved.is_file():
                    video_count += 1
                    video_bytes += resolved.stat().st_size
            except OSError:
                continue
        active = next(
            (job for job in self.jobs.values() if job.status in {JobStatus.RENDERING, JobStatus.ENCODING}),
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
