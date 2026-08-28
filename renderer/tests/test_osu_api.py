from __future__ import annotations

import unittest
from unittest.mock import AsyncMock

import httpx

from renderer.osu_api import OsuApiClient
from renderer.score_resolver import ScoreReference


class OsuApiFallbackTests(unittest.IsolatedAsyncioTestCase):
    async def test_ruleset_score_url_falls_back_to_modern_endpoint(self) -> None:
        client = OsuApiClient("1", "secret")
        client._get = AsyncMock(side_effect=[
            httpx.Response(404),
            httpx.Response(200, json={
                "id": 7_361_453_550,
                "ruleset": "osu",
                "beatmap": {"id": 1, "version": "Hard"},
                "beatmapset": {"id": 2, "artist": "Artist", "title": "Title"},
            }),
        ])
        try:
            metadata = await client.get_score(ScoreReference(7_361_453_550, "osu"))
        finally:
            await client.close()
        self.assertEqual(metadata.score_id, 7_361_453_550)
        self.assertEqual(
            [call.args[0] for call in client._get.await_args_list],
            ["/api/v2/scores/osu/7361453550", "/api/v2/scores/7361453550"],
        )

    async def test_modern_replay_download_falls_back_to_ruleset_endpoint(self) -> None:
        client = OsuApiClient("1", "secret")
        client._get = AsyncMock(side_effect=[httpx.Response(404), httpx.Response(200, content=b"replay")])
        try:
            replay = await client.download_replay(ScoreReference(123, None), "mania")
        finally:
            await client.close()
        self.assertEqual(replay, b"replay")
        self.assertEqual(
            [call.args[0] for call in client._get.await_args_list],
            ["/api/v2/scores/123/download", "/api/v2/scores/mania/123/download"],
        )
