from __future__ import annotations

import hashlib
import tempfile
import unittest
from pathlib import Path

from renderer.beatmap_index import BeatmapIndex


class BeatmapIndexTests(unittest.TestCase):
    def test_builds_and_reuses_id_and_md5_index(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            songs = root / "Songs"
            folder = songs / "123 Example"
            folder.mkdir(parents=True)
            beatmap = folder / "map.osu"
            content = b"osu file format v14\n[Metadata]\nBeatmapID:424242\n"
            beatmap.write_bytes(content)
            expected_md5 = hashlib.md5(content, usedforsecurity=False).hexdigest()
            index = BeatmapIndex(songs, root / "index.json")
            self.assertEqual(index.rebuild(), 1)
            self.assertEqual(index.resolve(md5=expected_md5).path, beatmap.resolve())
            self.assertEqual(index.resolve(beatmap_id=424242).md5, expected_md5)
            self.assertTrue((root / "index.json").is_file())
            self.assertEqual(index.rebuild(), 1)
