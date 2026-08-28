from __future__ import annotations

import asyncio
import hashlib
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from renderer.beatmap_index import BeatmapIndex
from renderer.beatmap_resolver import BeatmapResolver
from renderer.jobs import JobManager
from renderer.models import JobStatus, RenderJob, ScoreMetadata
from renderer.render_options import RenderOptions
from renderer.tests.helpers import replay_bytes
from renderer.tests.test_api import test_settings


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
            manager = JobManager(settings, FakeOsuApi(), BeatmapResolver(index), runner)  # type: ignore[arg-type]
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
