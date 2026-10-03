from __future__ import annotations

import tempfile
import unittest
from dataclasses import replace
from datetime import datetime
from pathlib import Path

from renderer.render_policy import RenderStartPolicy, time_is_allowed
from renderer.models import RenderJob
from renderer.render_options import RenderOptions
from renderer.tests.test_api import test_settings


class RenderPolicyTests(unittest.TestCase):
    def test_day_and_overnight_windows(self) -> None:
        self.assertTrue(time_is_allowed(datetime(2026, 9, 7, 12, 0), "09:00", "17:00"))
        self.assertFalse(time_is_allowed(datetime(2026, 9, 7, 18, 0), "09:00", "17:00"))
        self.assertTrue(time_is_allowed(datetime(2026, 9, 7, 23, 0), "22:00", "07:00"))
        self.assertTrue(time_is_allowed(datetime(2026, 9, 7, 6, 59), "22:00", "07:00"))
        self.assertFalse(time_is_allowed(datetime(2026, 9, 7, 12, 0), "22:00", "07:00"))
        self.assertTrue(time_is_allowed(datetime(2026, 9, 7, 12, 0), "00:00", "00:00"))

    def test_requires_idle_time_inside_window(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            settings = replace(
                test_settings(Path(temporary)),
                render_schedule_enabled=True,
                render_allowed_start_time="01:00",
                render_allowed_end_time="07:00",
                render_idle_only=True,
                render_idle_minutes=10,
            )
            busy = RenderStartPolicy(settings, now=lambda: datetime(2026, 9, 7, 2, 0), idle_seconds=lambda: 599)
            idle = RenderStartPolicy(settings, now=lambda: datetime(2026, 9, 7, 2, 0), idle_seconds=lambda: 600)
            self.assertFalse(busy.snapshot().allowed)
            self.assertTrue(idle.snapshot().allowed)

    def test_disabled_schedule_always_allows(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            settings = replace(test_settings(Path(temporary)), render_schedule_enabled=False)
            policy = RenderStartPolicy(settings, now=lambda: datetime(2026, 9, 7, 12, 0), idle_seconds=lambda: 0)
            self.assertTrue(policy.snapshot().allowed)

    def test_manual_jobs_are_marked_to_bypass_the_automatic_policy(self) -> None:
        manual = RenderJob("manual", "user", "score_url", "source", RenderOptions())
        automatic = RenderJob(
            "automatic",
            "auto",
            "score_url",
            "source-2",
            RenderOptions(),
            bypass_start_policy=False,
        )
        self.assertTrue(manual.bypass_start_policy)
        self.assertFalse(automatic.bypass_start_policy)


if __name__ == "__main__":
    unittest.main()
