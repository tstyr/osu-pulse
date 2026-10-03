from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import httpx

from renderer.models import ScoreMetadata
from renderer.youtube_uploader import YouTubeUploader, youtube_title


class YouTubeTitleTests(unittest.TestCase):
    def test_title_starts_with_rank_pp_accuracy_and_song(self) -> None:
        metadata = ScoreMetadata(
            rank="X",
            pp=321.54,
            accuracy=0.98765,
            artist="Artist",
            title="Song",
            difficulty="Insane",
        )
        self.assertEqual(
            youtube_title(metadata),
            "SS | 321.5pp | 98.77% | Artist - Song [Insane]",
        )

    def test_title_normalizes_youtube_forbidden_angle_brackets(self) -> None:
        metadata = ScoreMetadata(rank="B", pp=124.831, accuracy=0.8902, artist="Artist", title="Song", difficulty="Suki <3")
        self.assertEqual(youtube_title(metadata), "B | 124.8pp | 89.02% | Artist - Song [Suki ＜3]")

    def test_title_supports_admin_template(self) -> None:
        metadata = ScoreMetadata(rank="A", pp=150.25, accuracy=0.9678, artist="Artist", title="Song", player_name="Player")
        self.assertEqual(youtube_title(metadata, "{rank} {pp} · {player} · {artist} - {title}"), "A 150.2pp · Player · Artist - Song")


class YouTubeUploaderTests(unittest.IsolatedAsyncioTestCase):
    async def test_deletes_video_with_refreshed_oauth_token(self) -> None:
        calls: list[tuple[str, str]] = []

        def handler(request: httpx.Request) -> httpx.Response:
            calls.append((request.method, str(request.url)))
            if request.url.host == "oauth2.googleapis.com":
                return httpx.Response(200, json={"access_token": "access-token"})
            self.assertEqual(request.headers["authorization"], "Bearer access-token")
            return httpx.Response(204)

        settings = SimpleNamespace(
            youtube_auto_upload=True,
            youtube_client_id="client-id",
            youtube_client_secret="client-secret",
            youtube_refresh_token="refresh-token",
        )
        uploader = YouTubeUploader(settings, transport=httpx.MockTransport(handler))  # type: ignore[arg-type]
        await uploader.delete_video("abc123XYZ")
        self.assertEqual([method for method, _ in calls], ["POST", "DELETE"])

    async def test_refreshes_oauth_and_uses_resumable_unlisted_upload(self) -> None:
        calls: list[tuple[str, str]] = []
        request_body: dict[str, object] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            calls.append((request.method, str(request.url)))
            if request.url.host == "oauth2.googleapis.com":
                return httpx.Response(200, json={"access_token": "access-token"})
            if request.method == "POST":
                request_body.update(json.loads(request.content))
                return httpx.Response(
                    200,
                    headers={"Location": "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=test"},
                )
            if request.headers.get("content-range") == "bytes 0-7/12":
                return httpx.Response(308, headers={"Range": "bytes=0-7"})
            return httpx.Response(
                201,
                json={"id": "abc123XYZ", "status": {"privacyStatus": "unlisted"}},
            )

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            video = output / "render.mp4"
            video.write_bytes(b"hello world!")
            settings = SimpleNamespace(
                output_path=output,
                youtube_auto_upload=True,
                youtube_client_id="client-id",
                youtube_client_secret="client-secret",
                youtube_refresh_token="refresh-token",
                youtube_privacy_status="unlisted",
                youtube_category_id="20",
                youtube_upload_timeout_seconds=60,
                youtube_chunk_bytes=8,
            )
            metadata = ScoreMetadata(
                score_id=123,
                rank="S",
                pp=250.0,
                accuracy=0.975,
                artist="Artist",
                title="Song",
                difficulty="Hard",
                player_name="Player",
                ruleset="osu",
            )
            progress: list[int] = []
            uploader = YouTubeUploader(settings, transport=httpx.MockTransport(handler))  # type: ignore[arg-type]
            result = await uploader.upload(video, metadata, progress.append)

        self.assertEqual(result.url, "https://youtu.be/abc123XYZ")
        self.assertEqual(result.privacy_status, "unlisted")
        self.assertEqual(progress, [67])
        self.assertEqual(request_body["status"], {
            "privacyStatus": "unlisted",
            "embeddable": True,
            "license": "youtube",
        })
        self.assertEqual([method for method, _ in calls], ["POST", "POST", "PUT", "PUT"])
