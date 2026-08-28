from __future__ import annotations

import unittest
from types import SimpleNamespace

from renderer.danser_runner import DanserRunner, progress_from_line
from renderer.prerequisites import DependencyState


class DanserProgressTests(unittest.TestCase):
    def test_reads_danser_precise_progress(self) -> None:
        self.assertEqual(progress_from_line("Progress: 90%, Speed: 1.20x, ETA: 5s"), 90)

    def test_ignores_ffmpeg_percentages(self) -> None:
        self.assertIsNone(progress_from_line("muxing overhead: 0.196085%"))

    def test_auto_encoder_prefers_nvenc_then_amf_then_cpu(self) -> None:
        settings = SimpleNamespace(video_encoder="auto")
        self.assertEqual(DanserRunner(settings, DependencyState(nvenc=True, amf=True))._encoder(), "h264_nvenc")
        self.assertEqual(DanserRunner(settings, DependencyState(amf=True))._encoder(), "h264_amf")
        self.assertEqual(DanserRunner(settings, DependencyState())._encoder(), "libx264")
