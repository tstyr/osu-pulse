from __future__ import annotations

import json
import unittest
from pathlib import Path
from types import SimpleNamespace

from renderer.danser_runner import DanserRunner, progress_from_line
from renderer.models import RenderJob, ScoreMetadata
from renderer.prerequisites import DependencyState
from renderer.render_options import RenderOptions


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

    def test_standard_command_selects_appu_skin(self) -> None:
        settings = SimpleNamespace(
            songs_path=Path("C:/osu/Songs"),
            osu_skins_path=Path("C:/osu/Skins"),
            standard_skin="osu-pulse Appu",
            output_path=Path("C:/output"),
            danser_path=Path("C:/danser/danser-cli.exe"),
            danser_settings="default",
            standard_background_parallax=False,
            standard_key_overlay=True,
            standard_key_overlay_scale=1.2,
        )
        job = RenderJob("job", "user", "replay", "source", RenderOptions(), metadata=ScoreMetadata(ruleset="osu"))
        command = DanserRunner(settings, DependencyState())._command(job, Path("C:/replay.osr"), "libx264")
        self.assertIn("-skin=osu-pulse Appu", command)
        patch = json.loads(next(value.removeprefix("-sPatch=") for value in command if value.startswith("-sPatch=")))
        self.assertEqual(patch["General"]["OsuSkinsDir"], "C:\\osu\\Skins")
        self.assertEqual(patch["Skin"]["CurrentSkin"], "osu-pulse Appu")
        self.assertFalse(patch["Playfield"]["Background"]["Parallax"]["Enabled"])
        self.assertTrue(patch["Gameplay"]["KeyOverlay"]["Show"])
        self.assertEqual(patch["Gameplay"]["KeyOverlay"]["Scale"], 1.2)
