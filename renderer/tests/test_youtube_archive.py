from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from renderer.models import ScoreMetadata
from renderer.tests.test_api import test_settings
from renderer.youtube_archive import YouTubeArchive
from renderer.youtube_uploader import YouTubeUploadResult


class YouTubeArchiveTests(unittest.IsolatedAsyncioTestCase):
    async def test_records_upload_before_cleanup(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            settings = test_settings(Path(temporary))
            archive = YouTubeArchive(settings)
            job_id = "b" * 32
            result = YouTubeUploadResult("abc123XYZ", "https://youtu.be/abc123XYZ", "S | 123pp | Song", "public")

            await archive.record(job_id, result, ScoreMetadata(score_id=123), 4567)

            recorded = archive.get(job_id)
            self.assertIsNotNone(recorded)
            self.assertEqual(recorded["video_id"], "abc123XYZ")  # type: ignore[index]
            self.assertEqual(recorded["privacy_status"], "public")  # type: ignore[index]
            self.assertEqual(recorded["source_size"], 4567)  # type: ignore[index]
            cloud = archive.cloud_entries()
            self.assertEqual(cloud[0]["videoId"], "abc123XYZ")
            self.assertEqual(archive.job_id_for_video("abc123XYZ"), job_id)

            await archive.mark_deleted(job_id)
            deleted = archive.cloud_entries()[0]
            self.assertIsInstance(deleted["deletedAt"], str)
