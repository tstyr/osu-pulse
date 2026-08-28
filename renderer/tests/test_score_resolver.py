from __future__ import annotations

import unittest

from renderer.errors import ErrorCode, RenderError
from renderer.score_resolver import parse_score_url


class ScoreResolverTests(unittest.TestCase):
    def test_accepts_supported_score_urls(self) -> None:
        legacy = parse_score_url("https://osu.ppy.sh/scores/osu/1234567890/?foo=bar")
        mania = parse_score_url("https://osu.ppy.sh/scores/mania/555")
        modern = parse_score_url("https://osu.ppy.sh/scores/987654321")
        self.assertEqual((legacy.score_id, legacy.ruleset_hint), (1_234_567_890, "osu"))
        self.assertEqual((mania.score_id, mania.ruleset_hint), (555, "mania"))
        self.assertEqual((modern.score_id, modern.ruleset_hint), (987_654_321, None))

    def test_rejects_ssrf_and_unsupported_schemes(self) -> None:
        invalid = [
            "http://localhost/scores/1",
            "http://127.0.0.1/scores/1",
            "https://192.168.1.1/scores/1",
            "file:///C:/secret",
            "ftp://osu.ppy.sh/scores/1",
            "https://example.com/scores/1",
            "https://osu.ppy.sh.evil.example/scores/1",
            "https://osu.ppy.sh:444/scores/1",
            "https://attacker@osu.ppy.sh/scores/1",
            "https://osu.ppy.sh/scores/taiko/1",
            "https://osu.ppy.sh/scores/osu/1/extra",
        ]
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(RenderError) as caught:
                parse_score_url(value)
            self.assertEqual(caught.exception.code, ErrorCode.INVALID_OSU_URL)
