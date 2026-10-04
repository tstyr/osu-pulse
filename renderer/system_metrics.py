from __future__ import annotations

import asyncio
import json
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

THERMAL_ZONE_QUERY = (
    "$values = Get-CimInstance -Namespace root/wmi MSAcpi_ThermalZoneTemperature "
    "-ErrorAction SilentlyContinue | ForEach-Object { ($_.CurrentTemperature / 10) - 273.15 } "
    "| Where-Object { $_ -gt 0 -and $_ -lt 120 }; "
    "if ($values) { [Math]::Round(($values | Measure-Object -Average).Average, 1) }"
)

HARDWARE_SENSOR_QUERY = (
    "$values = @(Get-CimInstance -Namespace root/OpenHardwareMonitor Sensor -ErrorAction SilentlyContinue; "
    "Get-CimInstance -Namespace root/LibreHardwareMonitor Sensor -ErrorAction SilentlyContinue) "
    "| Where-Object { $_.SensorType -eq 'Temperature' -and $_.Value -gt 0 -and $_.Value -lt 120 }; "
    "$cpu = $values | Where-Object { $_.Name -match 'CPU|Core|Package|Tctl|Tdie' -or $_.Parent -match 'CPU' } "
    "| Select-Object -ExpandProperty Value; "
    "$gpu = $values | Where-Object { $_.Name -match 'GPU|Hot Spot|Core' -or $_.Parent -match 'GPU|NVIDIA|AMD|Radeon|GeForce' } "
    "| Select-Object -ExpandProperty Value; "
    "$out = @{}; "
    "if ($cpu) { $out.cpu = [Math]::Round(($cpu | Measure-Object -Maximum).Maximum, 1) }; "
    "if ($gpu) { $out.gpu = [Math]::Round(($gpu | Measure-Object -Maximum).Maximum, 1) }; "
    "$out | ConvertTo-Json -Compress"
)


class SystemMetricsCollector:
    def __init__(self, disk_path: Path, cache_seconds: float = 10.0) -> None:
        self.disk_path = disk_path
        self.cache_seconds = cache_seconds
        self._cached_at = 0.0
        self._cached: dict[str, Any] | None = None
        self._lock = asyncio.Lock()
        self._refresh_task: asyncio.Task[None] | None = None

    async def snapshot(self, manager: JobManager) -> dict[str, Any]:
        now = time.monotonic()
        async with self._lock:
            now = time.monotonic()
            if self._cached is None:
                # Health checks must not wait for slow WMI/GPU sensor commands.
                # Seed inexpensive values immediately, then refresh sensors in
                # the background on the next cache interval.
                self._cached = await asyncio.to_thread(self._collect_base_system)
                self._cached_at = now
            elif now - self._cached_at >= self.cache_seconds and (
                self._refresh_task is None or self._refresh_task.done()
            ):
                self._refresh_task = asyncio.create_task(self._refresh(), name="system-metrics-refresh")
        return {"system": self._cached, "render_stats": await asyncio.to_thread(manager.metrics_snapshot)}

    async def _refresh(self) -> None:
        try:
            refreshed = await asyncio.to_thread(self._collect_system)
        except Exception:
            return
        async with self._lock:
            self._cached = refreshed
            self._cached_at = time.monotonic()

    def _collect_system(self) -> dict[str, Any]:
        values = self._collect_base_system()
        values["gpu_percent"] = self._gpu_percent()
        values.update(self._temperatures())
        return values

    def _collect_base_system(self) -> dict[str, Any]:
        memory = psutil.virtual_memory()
        try:
            disk = psutil.disk_usage(str(self.disk_path))
        except (OSError, psutil.Error):
            disk = None
        network = psutil.net_io_counters()
        return {
            "cpu_percent": round(psutil.cpu_percent(interval=None), 1),
            "gpu_percent": None,
            "cpu_temperature_c": None,
            "gpu_temperature_c": None,
            "memory_used_bytes": int(memory.used),
            "memory_total_bytes": int(memory.total),
            "memory_percent": round(float(memory.percent), 1),
            "disk_available": disk is not None,
            "disk_used_bytes": int(disk.used) if disk else None,
            "disk_total_bytes": int(disk.total) if disk else None,
            "disk_percent": round(float(disk.percent), 1) if disk else None,
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

    @staticmethod
    def _temperatures() -> dict[str, float | None]:
        cpu_temperature = SystemMetricsCollector._psutil_cpu_temperature()
        gpu_temperature = SystemMetricsCollector._nvidia_gpu_temperature()
        if os.name == "nt":
            hardware = SystemMetricsCollector._windows_hardware_temperatures()
            cpu_temperature = cpu_temperature if cpu_temperature is not None else hardware.get("cpu")
            gpu_temperature = gpu_temperature if gpu_temperature is not None else hardware.get("gpu")
            cpu_temperature = cpu_temperature if cpu_temperature is not None else SystemMetricsCollector._windows_thermal_zone_temperature()
        return {
            "cpu_temperature_c": cpu_temperature,
            "gpu_temperature_c": gpu_temperature,
        }

    @staticmethod
    def _psutil_cpu_temperature() -> float | None:
        try:
            sensors = getattr(psutil, "sensors_temperatures", lambda: {})()
        except (AttributeError, OSError):
            return None
        values: list[float] = []
        for entries in sensors.values():
            for entry in entries:
                current = getattr(entry, "current", None)
                if isinstance(current, (int, float)) and 0 < current < 120:
                    values.append(float(current))
        return round(max(values), 1) if values else None

    @staticmethod
    def _nvidia_gpu_temperature() -> float | None:
        try:
            result = subprocess.run(
                ["nvidia-smi", "--query-gpu=temperature.gpu", "--format=csv,noheader,nounits"],
                capture_output=True,
                text=True,
                timeout=5,
                check=False,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            if result.returncode != 0:
                return None
            values = [float(line.strip()) for line in result.stdout.splitlines() if line.strip()]
            values = [value for value in values if 0 < value < 120]
            return round(max(values), 1) if values else None
        except (OSError, ValueError, subprocess.TimeoutExpired):
            return None

    @staticmethod
    def _windows_hardware_temperatures() -> dict[str, float]:
        try:
            result = subprocess.run(
                ["powershell", "-NoProfile", "-Command", HARDWARE_SENSOR_QUERY],
                capture_output=True,
                text=True,
                timeout=8,
                check=False,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            if result.returncode != 0 or not result.stdout.strip():
                return {}
            parsed = json.loads(result.stdout)
            return {
                key: round(float(value), 1)
                for key, value in parsed.items()
                if isinstance(value, (int, float)) and 0 < float(value) < 120
            }
        except (OSError, ValueError, subprocess.TimeoutExpired, json.JSONDecodeError):
            return {}

    @staticmethod
    def _windows_thermal_zone_temperature() -> float | None:
        try:
            result = subprocess.run(
                ["powershell", "-NoProfile", "-Command", THERMAL_ZONE_QUERY],
                capture_output=True,
                text=True,
                timeout=8,
                check=False,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            if result.returncode != 0 or not result.stdout.strip():
                return None
            return round(float(result.stdout.strip()), 1)
        except (OSError, ValueError, subprocess.TimeoutExpired):
            return None
