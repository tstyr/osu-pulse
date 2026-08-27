from __future__ import annotations

import unittest

from renderer.danser_runner import progress_from_line


class DanserProgressTests(unittest.TestCase):
    def test_reads_danser_precise_progress(self) -> None:
        self.assertEqual(progress_from_line("Progress: 90%, Speed: 1.20x, ETA: 5s"), 90)

    def test_ignores_ffmpeg_percentages(self) -> None:
        self.assertIsNone(progress_from_line("muxing overhead: 0.196085%"))
