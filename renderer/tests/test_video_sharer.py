from __future__ import annotations

import json
import sys
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

from renderer.tests.test_api import test_settings
from renderer.video_sharer import VideoSharer, target_video_bitrate_kbps


class VideoSharerTests(unittest.IsolatedAsyncioTestCase):
    async def test_runs_uploader_and_caches_valid_result(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            base = test_settings(root)
            base.ensure_directories()
            job_id = "c" * 32
            output = base.output_path / f"{job_id}.mp4"
            output.write_bytes(b"video")
            uploader = root / "fake_uploader.py"
            expected = {
                "url": "https://downloads.example.test/video.mp4",
                "size": 5,
                "provider": "vercel-blob",
            }
            uploader.write_text(
                f"import sys\nsys.stdout.write({json.dumps(json.dumps(expected))})\n",
                encoding="utf-8",
            )
            settings = replace(
                base,
                node_path=Path(sys.executable),
                video_upload_script=uploader,
                project_root=root,
                video_compress_enabled=False,
            )
            sharer = VideoSharer(settings)
            first = await sharer.share(job_id)
            second = await sharer.share(job_id)
            self.assertEqual(first, {
                **expected,
                "original_size": 5,
                "compressed": False,
            })
            self.assertIs(first, second)

    async def test_bitrate_scales_with_resolution_and_fps(self) -> None:
        baseline = target_video_bitrate_kbps(1920, 1080, 60)
        high_resolution = target_video_bitrate_kbps(3840, 2160, 60)
        high_fps = target_video_bitrate_kbps(1920, 1080, 240)
        self.assertEqual(baseline, 8_000)
        self.assertGreater(high_resolution, baseline)
        self.assertGreater(high_fps, baseline)
        self.assertLessEqual(target_video_bitrate_kbps(3840, 2160, 240), 50_000)


if __name__ == "__main__":
    unittest.main()
