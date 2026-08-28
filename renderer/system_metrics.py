from __future__ import annotations

import asyncio
import os
import subprocess
import time
from pathlib import Path
from typing import Any

import psutil

from .jobs import JobManager


GPU_QUERY = (
    "$values = Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine "
    "-ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'engtype_(3D|Compute|VideoEncode)' } "
    "| Select-Object -ExpandProperty UtilizationPercentage; "
    "if ($values) { [Math]::Min(100, [Math]::Round(($values | Measure-Object -Maximum).Maximum, 1)) } else { 0 }"
)


class SystemMetricsCollector:
    def __init__(self, disk_path: Path, cache_seconds: float = 10.0) -> None:
        self.disk_path = disk_path
        self.cache_seconds = cache_seconds
        self._cached_at = 0.0
        self._cached: dict[str, Any] | None = None
        self._lock = asyncio.Lock()

    async def snapshot(self, manager: JobManager) -> dict[str, Any]:
        now = time.monotonic()
        if self._cached and now - self._cached_at < self.cache_seconds:
            return {"system": self._cached, "render_stats": await asyncio.to_thread(manager.metrics_snapshot)}
        async with self._lock:
            now = time.monotonic()
            if not self._cached or now - self._cached_at >= self.cache_seconds:
                self._cached = await asyncio.to_thread(self._collect_system)
                self._cached_at = now
        return {"system": self._cached, "render_stats": await asyncio.to_thread(manager.metrics_snapshot)}

    def _collect_system(self) -> dict[str, Any]:
        memory = psutil.virtual_memory()
        disk = psutil.disk_usage(str(self.disk_path))
        network = psutil.net_io_counters()
        return {
            "cpu_percent": round(psutil.cpu_percent(interval=0.15), 1),
            "gpu_percent": self._gpu_percent(),
            "memory_used_bytes": int(memory.used),
            "memory_total_bytes": int(memory.total),
            "memory_percent": round(float(memory.percent), 1),
            "disk_used_bytes": int(disk.used),
            "disk_total_bytes": int(disk.total),
            "disk_percent": round(float(disk.percent), 1),
            "network_received_bytes": int(network.bytes_recv),
            "network_sent_bytes": int(network.bytes_sent),
            "uptime_seconds": max(0, int(time.time() - psutil.boot_time())),
        }

    @staticmethod
    def _gpu_percent() -> float | None:
        if os.name != "nt":
            return None
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        try:
            result = subprocess.run(
                ["powershell", "-NoProfile", "-Command", GPU_QUERY],
                capture_output=True,
                text=True,
                timeout=8,
                check=False,
                creationflags=creationflags,
            )
            if result.returncode != 0:
                return None
            return round(float(result.stdout.strip()), 1)
        except (OSError, ValueError, subprocess.TimeoutExpired):
            return None
