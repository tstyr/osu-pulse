from __future__ import annotations

from dataclasses import dataclass

from .errors import ErrorCode, RenderError


ALLOWED_RESOLUTIONS: dict[str, tuple[int, int]] = {
    "1920x1080": (1920, 1080),
    "2560x1440": (2560, 1440),
    "2560x1600": (2560, 1600),
    "3840x2160": (3840, 2160),
}
ALLOWED_FPS = {60, 120, 240}
ALLOWED_SPEEDS: dict[str, float | None] = {
    "original": None,
    "1.0": 1.0,
    "0.5": 0.5,
    "0.75": 0.75,
    "1.25": 1.25,
    "1.5": 1.5,
    "2.0": 2.0,
}


def _parse_bool(value: object, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str) and value.lower() in {"true", "1", "yes", "on"}:
        return True
    if isinstance(value, str) and value.lower() in {"false", "0", "no", "off"}:
        return False
    raise RenderError(ErrorCode.INVALID_OPTIONS, "motion_blur must be a boolean")


@dataclass(frozen=True, slots=True)
class RenderOptions:
    resolution: str = "1920x1080"
    fps: int = 60
    speed: str = "original"
    motion_blur: bool = False

    @classmethod
    def from_values(
        cls,
        resolution: object = None,
        fps: object = None,
        speed: object = None,
        motion_blur: object = None,
    ) -> "RenderOptions":
        resolution_value = str(resolution or "1920x1080")
        try:
            fps_value = int(fps or 60)
        except (TypeError, ValueError) as exc:
            raise RenderError(ErrorCode.INVALID_OPTIONS, "fps must be an integer") from exc
        speed_value = str(speed or "original")
        if resolution_value not in ALLOWED_RESOLUTIONS:
            raise RenderError(ErrorCode.INVALID_OPTIONS, "Unsupported resolution")
        if fps_value not in ALLOWED_FPS:
            raise RenderError(ErrorCode.INVALID_OPTIONS, "Unsupported FPS")
        if speed_value not in ALLOWED_SPEEDS:
            raise RenderError(ErrorCode.INVALID_OPTIONS, "Unsupported speed")
        return cls(resolution_value, fps_value, speed_value, _parse_bool(motion_blur))

    @property
    def size(self) -> tuple[int, int]:
        return ALLOWED_RESOLUTIONS[self.resolution]

    @property
    def speed_multiplier(self) -> float | None:
        return ALLOWED_SPEEDS[self.speed]

    def signature(self) -> str:
        return f"{self.resolution}:{self.fps}:{self.speed}:{int(self.motion_blur)}"
