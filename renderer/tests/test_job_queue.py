from __future__ import annotations

import asyncio
import hashlib
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from renderer.beatmap_index import BeatmapIndex
from renderer.beatmap_resolver import BeatmapResolver
from renderer.jobs import JobManager, overall_youtube_progress
from renderer.errors import RenderCancelled, RenderError
from renderer.models import JobStatus, RenderJob, ScoreMetadata
from renderer.render_options import RenderOptions
from renderer.tests.helpers import replay_bytes
from renderer.tests.test_api import test_settings
from renderer.youtube_uploader import YouTubeUploadError, YouTubeUploadResult


class FakeRunner:
    def __init__(self, output_path: Path) -> None:
        self.output_path = output_path
        self.active = 0
        self.maximum_active = 0
        self.dependencies = SimpleNamespace(
            songs_index_ready=False,
            songs_index_count=0,
            songs_index_error=None,
        )

    async def render(self, job: RenderJob, _replay_path: Path) -> Path:
        self.active += 1
        self.maximum_active = max(self.maximum_active, self.active)
        try:
            await asyncio.sleep(0.05)
            output = self.output_path / f"{job.id}.mp4"
            output.write_bytes(b"test-video")
            return output
        finally:
            self.active -= 1


class FakeOsuApi:
    pass


class FakeYouTubeUploader:
    configured = True

    def __init__(self) -> None:
        self.uploaded: list[Path] = []

    async def upload(self, video: Path, _metadata: ScoreMetadata, progress) -> YouTubeUploadResult:
        self.uploaded.append(video)
        progress(100)
        return YouTubeUploadResult("abc123XYZ", "https://youtu.be/abc123XYZ", "S | —pp | 98.00% | Song", "unlisted")


class FailingYouTubeUploader:
    configured = True

    async def upload(self, _video: Path, _metadata: ScoreMetadata, _progress) -> YouTubeUploadResult:
        raise YouTubeUploadError("quota exceeded")


class FakeLookupApi:
    def __init__(self) -> None:
        self.checksum: str | None = None

    async def lookup_beatmap(self, checksum: str) -> ScoreMetadata:
        self.checksum = checksum
        return ScoreMetadata(beatmap_id=987, beatmapset_id=654, title="Auto map")


class FakeDownloader:
    def __init__(self, songs_path: Path, map_content: bytes) -> None:
        self.songs_path = songs_path
        self.map_content = map_content
        self.installed: list[int] = []

    async def install(self, beatmapset_id: int) -> Path:
        self.installed.append(beatmapset_id)
        destination = self.songs_path / f"{beatmapset_id} Auto"
        destination.mkdir(parents=True)
        (destination / "auto.osu").write_bytes(self.map_content)
        return destination


class JobQueueTests(unittest.IsolatedAsyncioTestCase):
    async def test_status_polls_cache_disk_totals_but_keep_progress_current(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            settings = test_settings(Path(temporary))
            settings.ensure_directories()
            manager = JobManager(settings, FakeOsuApi(), None, FakeRunner(settings.output_path))  # type: ignore[arg-type]
            job = RenderJob("a" * 32, "user", "replay", "source", RenderOptions(), status=JobStatus.RENDERING, progress=10)
            manager.jobs[job.id] = job
            (settings.output_path / f"{job.id}.mp4").write_bytes(b"video")
            with patch("renderer.jobs.time.monotonic", side_effect=[100, 101, 111]):
                first = manager.metrics_snapshot()
                (settings.output_path / f"{job.id}.mp4").write_bytes(b"updated-video")
                job.progress = 60
                second = manager.metrics_snapshot()
                refreshed = manager.metrics_snapshot()

            self.assertEqual(first["video_bytes"], 5)
            self.assertEqual(second["video_bytes"], 5)
            self.assertEqual(second["active_progress"], 60)
            self.assertEqual(refreshed["video_bytes"], 13)

    async def test_thumbnail_playlist_failures_do_not_retry_an_uploaded_video(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            settings = test_settings(Path(temporary))
            settings.ensure_directories()
            job_id = "b" * 32
            manager = None

            class OptionalApiFailureUploader(FakeYouTubeUploader):
                async def upload_thumbnail(self, video_id, image_path):
                    self.recorded_before_thumbnail = manager.youtube_archive.get(job_id) is not None
                    raise OSError("thumbnail API unavailable")

                async def add_to_playlists(self, video_id, metadata):
                    raise RuntimeError("playlist API unavailable")

            uploader = OptionalApiFailureUploader()
            manager = JobManager(settings, FakeOsuApi(), None, FakeRunner(settings.output_path), youtube_uploader=uploader)  # type: ignore[arg-type]
            job = RenderJob(job_id, "user", "replay", "source", RenderOptions(), metadata=ScoreMetadata())
            job.output_path = settings.output_path / f"{job.id}.mp4"
            job.output_path.write_bytes(b"video")
            job.thumbnail_path = settings.output_path / f"{job.id}-thumbnail.jpg"
            job.thumbnail_path.write_bytes(b"thumbnail")

            await manager._upload_youtube(job)

            self.assertTrue(uploader.recorded_before_thumbnail)
            self.assertEqual(job.youtube_url, "https://youtu.be/abc123XYZ")
            self.assertIsNone(job.youtube_error)
            self.assertEqual(manager.youtube_archive.pending_entries(), {})
            self.assertEqual(manager.youtube_archive.get(job.id)["video_id"], "abc123XYZ")

    async def test_manual_render_skips_policy_deferred_automatic_jobs(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            settings = test_settings(Path(temporary))
            settings.ensure_directories()
            manager = JobManager(settings, FakeOsuApi(), None, FakeRunner(settings.output_path))  # type: ignore[arg-type]
            manager.render_policy = SimpleNamespace(snapshot=lambda: SimpleNamespace(allowed=False, reason="outside window"))
            automatic = RenderJob("auto", "user", "replay", "auto", RenderOptions(), status=JobStatus.QUEUED, bypass_start_policy=False)
            manual = RenderJob("manual", "user", "replay", "manual", RenderOptions(), status=JobStatus.QUEUED)
            manager.jobs = {job.id: job for job in (automatic, manual)}
            manager._queued_ids = [automatic.id, manual.id]

            selected = await asyncio.wait_for(manager._next_render_job(), timeout=0.5)

            self.assertIs(selected, manual)
            self.assertEqual(manager._queued_ids, [automatic.id])
            self.assertEqual(automatic.message, "outside window")
            self.assertIsNone(manual.queue_position)
            self.assertEqual(automatic.queue_position, 1)

    async def test_priority_does_not_enqueue_reserved_job_a_second_time(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            settings = test_settings(Path(temporary))
            settings.ensure_directories()
            manager = JobManager(settings, FakeOsuApi(), None, FakeRunner(settings.output_path))  # type: ignore[arg-type]
            jobs = [RenderJob(str(index), "user", "replay", str(index), RenderOptions(), status=JobStatus.QUEUED) for index in range(3)]
            manager.jobs = {job.id: job for job in jobs}
            manager._queued_ids = [job.id for job in jobs]

            first = await manager._next_render_job()
            with self.assertRaises(RenderError):
                await manager.prioritize(first.id)
            await manager.prioritize(jobs[2].id)
            second, third = await asyncio.gather(manager._next_render_job(), manager._next_render_job())

            self.assertEqual([first.id, second.id, third.id], ["0", "2", "1"])
            self.assertEqual(manager.queue_size, 0)

    async def test_pending_worker_wakes_immediately_for_a_manual_job(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            settings = test_settings(Path(temporary))
            settings.ensure_directories()
            manager = JobManager(settings, FakeOsuApi(), None, FakeRunner(settings.output_path))  # type: ignore[arg-type]
            waiting = asyncio.create_task(manager._next_render_job())
            await asyncio.sleep(0)
            manual = RenderJob("manual", "user", "replay", "manual", RenderOptions(), status=JobStatus.QUEUED)
            manager.jobs[manual.id] = manual
            manager._queued_ids.append(manual.id)
            manager._queue_changed.set()
            self.assertIs(await asyncio.wait_for(waiting, timeout=0.5), manual)

    async def test_youtube_cancel_propagates_and_does_not_schedule_a_retry(self) -> None:
        await self._assert_youtube_upload_cancelled(cancel_job=True)

    async def test_youtube_upload_child_stops_when_worker_is_cancelled(self) -> None:
        await self._assert_youtube_upload_cancelled(cancel_job=False)

    async def _assert_youtube_upload_cancelled(self, *, cancel_job: bool) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            settings = test_settings(Path(temporary))
            settings.ensure_directories()
            started = asyncio.Event()
            stopped = asyncio.Event()

            class BlockingUploader:
                configured = True

                async def upload(self, *args):
                    started.set()
                    try:
                        await asyncio.Event().wait()
                    finally:
                        stopped.set()

            manager = JobManager(settings, FakeOsuApi(), None, FakeRunner(settings.output_path), youtube_uploader=BlockingUploader())  # type: ignore[arg-type]
            job = RenderJob("a" * 32, "user", "replay", "source", RenderOptions(), metadata=ScoreMetadata())
            job.output_path = settings.output_path / f"{job.id}.mp4"
            job.output_path.write_bytes(b"video")
            worker = asyncio.create_task(manager._upload_youtube(job))
            await asyncio.wait_for(started.wait(), timeout=0.5)
            if cancel_job:
                job.cancel_requested.set()
            else:
                worker.cancel()

            with self.assertRaises(RenderCancelled if cancel_job else asyncio.CancelledError):
                await asyncio.wait_for(worker, timeout=0.5)
            self.assertTrue(stopped.is_set())
            self.assertIsNone(job.youtube_error)
            self.assertEqual(manager.youtube_archive.pending_entries(), {})
            self.assertTrue(job.output_path.is_file())

    def test_maps_youtube_progress_to_final_stage(self) -> None:
        self.assertEqual(overall_youtube_progress(0), 90)
        self.assertEqual(overall_youtube_progress(50), 94)
        self.assertEqual(overall_youtube_progress(100), 99)

    async def test_youtube_failure_is_recorded_without_failing_render(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            settings = test_settings(root)
            settings.ensure_directories()
            index = BeatmapIndex(settings.songs_path, settings.beatmap_index_path)
            manager = JobManager(  # type: ignore[arg-type]
                settings,
                FakeOsuApi(),
                BeatmapResolver(index),
                FakeRunner(settings.output_path),
                youtube_uploader=FailingYouTubeUploader(),
            )
            output = settings.output_path / "job.mp4"
            output.write_bytes(b"video")
            job = RenderJob("job", "100", "replay", "source", RenderOptions(), metadata=ScoreMetadata())
            job.output_path = output

            await manager._upload_youtube(job)

            self.assertEqual(job.youtube_error, "quota exceeded")
            self.assertIsNone(job.youtube_url)

    async def test_only_one_render_runs_at_a_time(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            settings = test_settings(root)
            settings.ensure_directories()
            map_folder = settings.songs_path / "1 Test"
            map_folder.mkdir()
            map_path = map_folder / "test.osu"
            map_content = b"osu file format v14\n[Metadata]\nBeatmapID:1\n"
            map_path.write_bytes(map_content)
            md5 = hashlib.md5(map_content, usedforsecurity=False).hexdigest()
            index = BeatmapIndex(settings.songs_path, settings.beatmap_index_path)
            index.rebuild()
            runner = FakeRunner(settings.output_path)
            youtube = FakeYouTubeUploader()
            manager = JobManager(  # type: ignore[arg-type]
                settings,
                FakeOsuApi(),
                BeatmapResolver(index),
                runner,
                youtube_uploader=youtube,
            )
            await manager.start()
            try:
                options = RenderOptions()
                jobs = [
                    await manager.submit_replay("100", replay_bytes(md5, replay_md5="1" * 32), options),
                    await manager.submit_replay("100", replay_bytes(md5, replay_md5="2" * 32), options),
                    await manager.submit_replay("200", replay_bytes(md5, replay_md5="3" * 32), options),
                ]
                deadline = asyncio.get_running_loop().time() + 5
                while any(job.status not in {JobStatus.COMPLETED, JobStatus.FAILED} for job in jobs):
                    if asyncio.get_running_loop().time() > deadline:
                        self.fail("render queue did not finish in time")
                    await asyncio.sleep(0.01)
                self.assertTrue(all(job.status == JobStatus.COMPLETED for job in jobs))
                self.assertEqual(runner.maximum_active, 1)
                self.assertEqual(len(youtube.uploaded), 3)
                self.assertTrue(all(job.youtube_privacy_status == "unlisted" for job in jobs))
            finally:
                await manager.stop()

    async def test_two_render_workers_can_run_in_parallel(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            settings = replace(test_settings(root), max_concurrent_renders=2)
            settings.ensure_directories()
            map_folder = settings.songs_path / "1 Test"
            map_folder.mkdir()
            map_content = b"osu file format v14\n[Metadata]\nBeatmapID:1\n"
            (map_folder / "test.osu").write_bytes(map_content)
            md5 = hashlib.md5(map_content, usedforsecurity=False).hexdigest()
            index = BeatmapIndex(settings.songs_path, settings.beatmap_index_path)
            index.rebuild()
            runner = FakeRunner(settings.output_path)
            manager = JobManager(  # type: ignore[arg-type]
                settings,
                FakeOsuApi(),
                BeatmapResolver(index),
                runner,
            )
            await manager.start()
            try:
                jobs = [
                    await manager.submit_replay("100", replay_bytes(md5, replay_md5="5" * 32), RenderOptions()),
                    await manager.submit_replay("200", replay_bytes(md5, replay_md5="6" * 32), RenderOptions()),
                ]
                deadline = asyncio.get_running_loop().time() + 5
                while any(job.status not in {JobStatus.COMPLETED, JobStatus.FAILED} for job in jobs):
                    if asyncio.get_running_loop().time() > deadline:
                        self.fail("parallel render queue did not finish in time")
                    await asyncio.sleep(0.01)
                self.assertTrue(all(job.status == JobStatus.COMPLETED for job in jobs))
                self.assertEqual(runner.maximum_active, 2)
            finally:
                await manager.stop()

    async def test_missing_beatmap_is_looked_up_downloaded_and_indexed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            settings = test_settings(root)
            settings.ensure_directories()
            map_content = b"osu file format v14\n[Metadata]\nBeatmapID:987\nBeatmapSetID:654\n"
            checksum = hashlib.md5(map_content, usedforsecurity=False).hexdigest()
            index = BeatmapIndex(settings.songs_path, settings.beatmap_index_path)
            index.rebuild()
            runner = FakeRunner(settings.output_path)
            osu_api = FakeLookupApi()
            downloader = FakeDownloader(settings.songs_path, map_content)
            manager = JobManager(  # type: ignore[arg-type]
                settings,
                osu_api,
                BeatmapResolver(index),
                runner,
                downloader,
            )
            await manager.start()
            try:
                job = await manager.submit_replay(
                    "100",
                    replay_bytes(checksum, replay_md5="4" * 32),
                    RenderOptions(),
                )
                deadline = asyncio.get_running_loop().time() + 5
                while job.status not in {JobStatus.COMPLETED, JobStatus.FAILED}:
                    if asyncio.get_running_loop().time() > deadline:
                        self.fail("automatic beatmap preparation did not finish")
                    await asyncio.sleep(0.01)

                self.assertEqual(job.status, JobStatus.COMPLETED)
                self.assertEqual(osu_api.checksum, checksum)
                self.assertEqual(downloader.installed, [654])
                self.assertEqual(runner.dependencies.songs_index_count, 1)
            finally:
                await manager.stop()
