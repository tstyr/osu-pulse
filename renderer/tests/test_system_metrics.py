from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from renderer.system_metrics import SystemMetricsCollector


class SystemMetricsTests(unittest.TestCase):
    def test_removed_usb_reports_unavailable_disk_without_breaking_health_metrics(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            collector = SystemMetricsCollector(Path(temporary) / "unmounted")
            with patch("renderer.system_metrics.psutil.disk_usage", side_effect=FileNotFoundError("USB absent")):
                metrics = collector._collect_base_system()
            self.assertFalse(metrics["disk_available"])
            self.assertIsNone(metrics["disk_used_bytes"])
            self.assertIsNone(metrics["disk_total_bytes"])
            self.assertIsNone(metrics["disk_percent"])
            self.assertGreater(metrics["memory_total_bytes"], 0)
