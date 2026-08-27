from __future__ import annotations

import asyncio
import hashlib
import tempfile
import unittest
from pathlib import Path

from renderer.beatmap_index import BeatmapIndex
from renderer.beatmap_resolver import BeatmapResolver
from renderer.jobs import JobManager
from renderer.models import JobStatus, RenderJob
from renderer.render_options import RenderOptions
from renderer.tests.helpers import replay_bytes
from renderer.tests.test_api import test_settings


class FakeRunner:
    def __init__(self, output_path: Path) -> None:
        self.output_path = output_path
        self.active = 0
        self.maximum_active = 0

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
