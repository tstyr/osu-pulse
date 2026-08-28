from __future__ import annotations

import tempfile
import unittest
import zipfile
from pathlib import Path

from renderer.beatmap_downloader import BeatmapDownloader
from renderer.config import Settings
from renderer.errors import ErrorCode, RenderError


class BeatmapDownloaderTests(unittest.TestCase):
    def settings(self, root: Path) -> Settings:
        return Settings(
            host="127.0.0.1",
            port=8765,
            server_token=None,
            osu_client_id=None,
            osu_client_secret=None,
            danser_path=None,
            ffmpeg_path=None,
            songs_path=root / "Songs",
            temp_path=root / "temp",
            output_path=root / "output",
            log_path=root / "logs",
            beatmap_index_path=root / "index.json",
            max_concurrent_renders=1,
            max_jobs_per_user=2,
            max_replay_bytes=1024 * 1024,
            render_timeout_seconds=10,
            output_retention_hours=24,
            keep_failed_temp=False,
            video_encoder="auto",
            danser_settings="default",
            stats_path=root / "stats.json",
        )

    def test_extracts_valid_osz_into_managed_songs_folder(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            settings = self.settings(root)
            settings.ensure_directories()
            archive = root / "map.osz"
            with zipfile.ZipFile(archive, "w") as bundle:
                bundle.writestr("audio.mp3", b"audio")
                bundle.writestr("Artist - Title (Mapper) [Hard].osu", "osu file format v14")

            downloader = BeatmapDownloader(settings)
            try:
                destination = downloader._extract_archive(archive, 123)
            finally:
                import asyncio

                asyncio.run(downloader.close())

            self.assertTrue((destination / ".osu-pulse-managed").is_file())
            self.assertEqual(len(list(destination.glob("*.osu"))), 1)
            self.assertTrue(destination.is_relative_to(settings.songs_path.resolve()))

    def test_rejects_archive_path_traversal(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            settings = self.settings(root)
            settings.ensure_directories()
            archive = root / "unsafe.osz"
            with zipfile.ZipFile(archive, "w") as bundle:
                bundle.writestr("../escape.osu", "osu file format v14")

            downloader = BeatmapDownloader(settings)
            try:
                with self.assertRaises(RenderError) as context:
                    downloader._extract_archive(archive, 456)
            finally:
                import asyncio

                asyncio.run(downloader.close())

            self.assertEqual(context.exception.code, ErrorCode.BEATMAP_DOWNLOAD_FAILED)
            self.assertFalse((root / "escape.osu").exists())


if __name__ == "__main__":
    unittest.main()
