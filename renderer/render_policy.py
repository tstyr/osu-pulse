from __future__ import annotations

import ctypes
import os
from dataclasses import dataclass
from datetime import datetime
from typing import Callable

from .config import Settings


def _minute_of_day(value: str) -> int:
    try:
        hours, minutes = (int(part) for part in value.split(":"))
    except (TypeError, ValueError) as exc:
        raise ValueError("render schedule times must use HH:MM") from exc
    if not 0 <= hours <= 23 or not 0 <= minutes <= 59:
        raise ValueError("render schedule times must use HH:MM")
    return hours * 60 + minutes


def time_is_allowed(now: datetime, start: str, end: str) -> bool:
    current = now.hour * 60 + now.minute
    first = _minute_of_day(start)
    last = _minute_of_day(end)
    if first == last:
        return True
    if first < last:
        return first <= current < last
    return current >= first or current < last


def windows_idle_seconds() -> float | None:
    if os.name != "nt":
        return None

    class LASTINPUTINFO(ctypes.Structure):
        _fields_ = [("cbSize", ctypes.c_uint), ("dwTime", ctypes.c_uint)]

    value = LASTINPUTINFO()
    value.cbSize = ctypes.sizeof(value)
    try:
        if not ctypes.windll.user32.GetLastInputInfo(ctypes.byref(value)):
            return None
        tick_now = int(ctypes.windll.kernel32.GetTickCount64())
    except (AttributeError, OSError):
        return None
    # dwTime is a wrapping 32-bit tick count while GetTickCount64 is monotonic.
    elapsed_ms = (tick_now & 0xFFFFFFFF) - int(value.dwTime)
    if elapsed_ms < 0:
        elapsed_ms += 2**32
    return max(0.0, elapsed_ms / 1000.0)


@dataclass(frozen=True, slots=True)
class RenderPolicyState:
    allowed: bool
    reason: str
    idle_seconds: float | None
    inside_time_window: bool

    def public_dict(self) -> dict[str, object]:
        return {
            "allowed": self.allowed,
            "reason": self.reason,
            "idle_seconds": round(self.idle_seconds, 1) if self.idle_seconds is not None else None,
            "inside_time_window": self.inside_time_window,
        }


class RenderStartPolicy:
    def __init__(
        self,
        settings: Settings,
        *,
        now: Callable[[], datetime] | None = None,
        idle_seconds: Callable[[], float | None] | None = None,
    ) -> None:
        self.settings = settings
        self._now = now or datetime.now
        self._idle_seconds = idle_seconds or windows_idle_seconds

    def snapshot(self) -> RenderPolicyState:
        if not self.settings.render_schedule_enabled:
            return RenderPolicyState(True, "smart schedule disabled", None, True)
        inside = time_is_allowed(
            self._now(),
            self.settings.render_allowed_start_time,
            self.settings.render_allowed_end_time,
        )
        if not inside:
            return RenderPolicyState(
                False,
                f"waiting for allowed time {self.settings.render_allowed_start_time}-{self.settings.render_allowed_end_time}",
                None,
                False,
            )
        if not self.settings.render_idle_only:
            return RenderPolicyState(True, "inside allowed time", None, True)
        idle = self._idle_seconds()
        if idle is None:
            # Unsupported platforms must not deadlock a queue indefinitely.
            return RenderPolicyState(True, "idle detection unavailable; time window accepted", None, True)
        required = self.settings.render_idle_minutes * 60
        if idle < required:
            remaining = max(1, round((required - idle) / 60))
            return RenderPolicyState(False, f"waiting for PC idle ({remaining} min remaining)", idle, True)
        return RenderPolicyState(True, "PC is idle inside allowed time", idle, True)

    def can_start_now(self) -> bool:
        return self.snapshot().allowed
