from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from renderer.config import Settings
from renderer.models import JobStatus, RenderJob
from renderer.render_options import RenderOptions
from renderer.server import create_app


def test_settings(root: Path, *, token: str | None = None) -> Settings:
    songs = root / "Songs"
    songs.mkdir()
    return Settings(
        host="127.0.0.1",
        port=8765,
        server_token=token,
        osu_client_id=None,
        osu_client_secret=None,
        danser_path=root / "missing-danser.exe",
        ffmpeg_path=root / "missing-ffmpeg.exe",
        songs_path=songs,
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
        youtube_upload_registry_path=root / "youtube-uploads.json",
    )


class ApiTests(unittest.TestCase):
    def test_health_starts_degraded_and_invalid_url_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            with TestClient(create_app(test_settings(Path(temporary)))) as client:
                health = client.get("/health")
                self.assertEqual(health.status_code, 200)
                self.assertEqual(health.json()["status"], "degraded")
                response = client.post("/render", json={"type": "score_url", "url": "https://example.com/scores/1", "user_id": "123"})
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["error_code"], "INVALID_OSU_URL")

    def test_bearer_token_is_required_when_configured(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            with TestClient(create_app(test_settings(Path(temporary), token="test-token"))) as client:
                self.assertEqual(client.get("/health").status_code, 401)
                self.assertEqual(client.get("/health", headers={"Authorization": "Bearer test-token"}).status_code, 200)

    def test_share_rejects_missing_output(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            with TestClient(create_app(test_settings(Path(temporary)))) as client:
                response = client.post(f"/jobs/{'a' * 32}/share")
                self.assertEqual(response.status_code, 410)
                self.assertEqual(response.json()["error_code"], "VIDEO_NOT_READY")

    def test_share_returns_youtube_after_local_cleanup(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            with TestClient(create_app(test_settings(Path(temporary)))) as client:
                job_id = "a" * 32
                job = RenderJob(job_id, "100", "replay", "source", RenderOptions())
                job.status = JobStatus.COMPLETED
                job.output_path = Path(temporary) / "output" / f"{job_id}.mp4"
                job.output_size_bytes = 1234
                job.youtube_url = "https://youtu.be/abc123XYZ"
                client.app.state.jobs.jobs[job_id] = job

                response = client.post(f"/jobs/{job_id}/share")

                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["provider"], "youtube")
                self.assertEqual(response.json()["size"], 1234)
