from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

from renderer.models import ScoreMetadata
from renderer.tests.test_api import test_settings
from renderer.youtube_archive import YouTubeArchive
from renderer.youtube_uploader import YouTubeUploadResult


class YouTubeArchiveTests(unittest.IsolatedAsyncioTestCase):
    async def test_diagnostics_expose_reauthorization_without_credentials(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            settings = SimpleNamespace(youtube_upload_registry_path=Path(temporary) / "youtube-uploads.json", youtube_refresh_token="private-token", youtube_client_id="private-client", youtube_auto_upload=True)
            archive = YouTubeArchive(settings)
            await archive.record_pending("a" * 32, ScoreMetadata(), 100, "YouTube OAuth refresh failed: HTTP 400: invalid_grant")

            diagnostics = archive.diagnostics()

            self.assertEqual(diagnostics["auth_status"], "reauthorization_required")
            self.assertEqual(diagnostics["pending_count"], 1)
            self.assertTrue(diagnostics["enabled"])
            self.assertNotIn("private-token", str(diagnostics))
            self.assertNotIn("private-client", str(diagnostics))
            settings.youtube_refresh_token = "new-private-token"
            self.assertEqual(archive.diagnostics()["auth_status"], "unchecked")
            self.assertIsNone(archive.diagnostics()["last_error"])

    async def test_legacy_naive_retry_timestamp_is_accepted(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            archive = YouTubeArchive(test_settings(Path(temporary)))
            archive._write_pending({"a" * 32: {"next_attempt_at": "2020-01-01T00:00:00"}})
            self.assertEqual([job_id for job_id, _ in archive.due_pending()], ["a" * 32])

    async def test_invalid_grant_waits_but_new_credentials_retry_immediately(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            settings = SimpleNamespace(
                youtube_upload_registry_path=root / "youtube-uploads.json",
                youtube_refresh_token="expired-token",
            )
            archive = YouTubeArchive(settings)
            await archive.record_pending(
                "a" * 32,
                ScoreMetadata(score_id=123),
                100,
                "YouTube OAuth refresh failed: HTTP 400: invalid_grant",
            )
            self.assertEqual(archive.due_pending(), [])

            settings.youtube_refresh_token = "replacement-token"
            due = archive.due_pending()
            self.assertEqual([job_id for job_id, _ in due], ["a" * 32])

    async def test_upload_limit_is_persisted_for_retry_and_cleared_on_success(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            settings = test_settings(Path(temporary))
            archive = YouTubeArchive(settings)
            job_id = "a" * 32
            metadata = ScoreMetadata(score_id=321)

            await archive.record_pending(
                job_id,
                metadata,
                9876,
                "The user has exceeded the number of videos they may upload.",
            )

            pending = archive.pending_entries()[job_id]
            self.assertEqual(pending["attempts"], 1)
            self.assertEqual(pending["source_size"], 9876)
            self.assertFalse(pending["cleanup_after_upload"])
            self.assertGreater(datetime.fromisoformat(pending["next_attempt_at"]), datetime.now(timezone.utc))

            result = YouTubeUploadResult("retry123", "https://youtu.be/retry123", "A | 100pp | Retry", "public")
            await archive.record(job_id, result, metadata, 9876)

            self.assertNotIn(job_id, archive.pending_entries())
            self.assertEqual(archive.get(job_id)["video_id"], "retry123")  # type: ignore[index]

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

    async def test_pending_cleanup_flag_survives_retry_updates(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            settings = test_settings(Path(temporary))
            archive = YouTubeArchive(settings)
            job_id = "c" * 32
            metadata = ScoreMetadata(title="Comparison")

            await archive.record_pending(job_id, metadata, 1234, "first failure", cleanup_after_upload=True)
            await archive.record_pending(job_id, metadata, 1234, "second failure")

            pending = archive.pending_entries()[job_id]
            self.assertEqual(pending["attempts"], 2)
            self.assertTrue(pending["cleanup_after_upload"])
