from __future__ import annotations

import unittest

from renderer.errors import ErrorCode, RenderError
from renderer.replay_parser import mods_from_bits, parse_replay
from renderer.tests.helpers import replay_bytes


class ReplayParserTests(unittest.TestCase):
    def test_parses_valid_standard_replay_header(self) -> None:
        replay = parse_replay(replay_bytes("a" * 32))
        self.assertEqual(replay.mode, 0)
        self.assertEqual(replay.beatmap_md5, "a" * 32)
        self.assertEqual(replay.player_name, "Test Player")
        self.assertEqual(mods_from_bits(replay.mods_raw), ["HD"])

    def test_rejects_truncated_or_invalid_replay(self) -> None:
        for data in (b"not-a-replay", replay_bytes("not-an-md5"), replay_bytes("a" * 32)[:-1]):
            with self.subTest(size=len(data)), self.assertRaises(RenderError) as caught:
                parse_replay(data)
            self.assertEqual(caught.exception.code, ErrorCode.INVALID_REPLAY)

    def test_preserves_ruleset_for_caller_validation(self) -> None:
        self.assertEqual(parse_replay(replay_bytes("a" * 32, mode=3)).mode, 3)
