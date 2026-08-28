from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urlsplit

from .errors import ErrorCode, RenderError


SCORE_PATH = re.compile(r"^/scores/(?:(osu|mania)/)?([1-9][0-9]{0,18})/?$")


@dataclass(frozen=True, slots=True)
class ScoreReference:
    score_id: int
    ruleset_hint: str | None

    @property
    def canonical_url(self) -> str:
        prefix = f"{self.ruleset_hint}/" if self.ruleset_hint else ""
        return f"https://osu.ppy.sh/scores/{prefix}{self.score_id}"


def parse_score_url(value: str) -> ScoreReference:
    try:
        parsed = urlsplit(value.strip())
    except ValueError as exc:
        raise RenderError(ErrorCode.INVALID_OSU_URL, "Invalid osu! score URL") from exc

    if parsed.scheme != "https" or (parsed.hostname or "").lower() != "osu.ppy.sh" or parsed.username or parsed.password:
        raise RenderError(ErrorCode.INVALID_OSU_URL, "Only https://osu.ppy.sh score URLs are allowed")
    try:
        if parsed.port not in (None, 443):
            raise RenderError(ErrorCode.INVALID_OSU_URL, "Unexpected port in osu! score URL")
    except ValueError as exc:
        raise RenderError(ErrorCode.INVALID_OSU_URL, "Invalid port in osu! score URL") from exc

    match = SCORE_PATH.fullmatch(parsed.path)
    if not match:
        raise RenderError(ErrorCode.INVALID_OSU_URL, "Invalid osu! score URL path")
    score_id = int(match.group(2))
    if score_id > 9_223_372_036_854_775_807:
        raise RenderError(ErrorCode.INVALID_SCORE_ID, "Score ID is out of range")
    return ScoreReference(score_id=score_id, ruleset_hint=match.group(1))
