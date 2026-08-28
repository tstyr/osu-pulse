from __future__ import annotations

import unittest

from renderer.configure_r2 import parse_bucket_url


class ConfigureR2Tests(unittest.TestCase):
    def test_splits_account_endpoint_and_bucket(self) -> None:
        endpoint, bucket = parse_bucket_url(
            "https://ee3052802d9f583ae4332492cedbc291.r2.cloudflarestorage.com/osu-video-disk"
        )
        self.assertEqual(
            endpoint,
            "https://ee3052802d9f583ae4332492cedbc291.r2.cloudflarestorage.com",
        )
        self.assertEqual(bucket, "osu-video-disk")

    def test_rejects_non_r2_or_multi_path_url(self) -> None:
        for value in (
            "http://ee3052802d9f583ae4332492cedbc291.r2.cloudflarestorage.com/bucket",
            "https://example.com/bucket",
            "https://ee3052802d9f583ae4332492cedbc291.r2.cloudflarestorage.com/a/b",
        ):
            with self.subTest(value=value), self.assertRaises(ValueError):
                parse_bucket_url(value)


if __name__ == "__main__":
    unittest.main()
