from __future__ import annotations

import asyncio
import re
import time
from typing import Any
from urllib.parse import quote

import httpx

from .errors import ErrorCode, RenderError
from .models import ScoreMetadata
from .score_resolver import ScoreReference


RULESET_BY_ID = {0: "osu", 1: "taiko", 2: "fruits", 3: "mania"}


class OsuApiClient:
    def __init__(self, client_id: str | None, client_secret: str | None) -> None:
        self.client_id = client_id
        self.client_secret = client_secret
        self._token: str | None = None
        self._token_expires_at = 0.0
        self._token_lock = asyncio.Lock()
        self._client = httpx.AsyncClient(
            base_url="https://osu.ppy.sh",
            timeout=httpx.Timeout(20.0, connect=5.0),
            follow_redirects=False,
            headers={"Accept": "application/json", "User-Agent": "osu-pulse-local-renderer/1.0"},
        )

    @property
    def configured(self) -> bool:
        return bool(self.client_id and self.client_secret)

    async def close(self) -> None:
        await self._client.aclose()

    async def _access_token(self, *, force: bool = False) -> str:
        if not self.configured:
            raise RenderError(ErrorCode.OAUTH_FAILED, "osu! API credentials are not configured")
        now = time.monotonic()
        if not force and self._token and now < self._token_expires_at:
            return self._token
        async with self._token_lock:
            now = time.monotonic()
            if not force and self._token and now < self._token_expires_at:
                return self._token
            try:
                response = await self._client.post(
                    "/oauth/token",
                    json={
                        "client_id": int(self.client_id or "0"),
                        "client_secret": self.client_secret,
                        "grant_type": "client_credentials",
                        "scope": "public",
                    },
                )
            except (httpx.TimeoutException, httpx.NetworkError) as exc:
                raise RenderError(ErrorCode.OSU_API_UNAVAILABLE, "osu! OAuth is unavailable", http_status=503) from exc
            if response.status_code != 200:
                raise RenderError(ErrorCode.OAUTH_FAILED, "osu! OAuth rejected the configured client", http_status=503)
            payload = response.json()
            token = payload.get("access_token")
            if not isinstance(token, str) or not token:
                raise RenderError(ErrorCode.OAUTH_FAILED, "osu! OAuth response was invalid", http_status=503)
            expires_in = max(60, int(payload.get("expires_in", 86400)))
            self._token = token
            self._token_expires_at = time.monotonic() + expires_in - min(60, expires_in // 10)
            return token

    async def _get(self, path: str, *, accept: str = "application/json") -> httpx.Response:
        for attempt in range(2):
            token = await self._access_token(force=attempt == 1)
            try:
                response = await self._client.get(path, headers={"Authorization": f"Bearer {token}", "Accept": accept})
            except (httpx.TimeoutException, httpx.NetworkError) as exc:
                raise RenderError(ErrorCode.OSU_API_UNAVAILABLE, "osu! API is unavailable", http_status=503) from exc
            if response.status_code != 401 or attempt == 1:
                return response
        raise AssertionError("unreachable")

    async def get_score(self, reference: ScoreReference) -> ScoreMetadata:
        if reference.ruleset_hint:
            path = f"/api/v2/scores/{reference.ruleset_hint}/{reference.score_id}"
        else:
            path = f"/api/v2/scores/{reference.score_id}"
        response = await self._get(path)
        if response.status_code == 404:
            raise RenderError(ErrorCode.SCORE_NOT_FOUND, "Score not found", http_status=404)
        if response.status_code != 200:
            raise RenderError(ErrorCode.OSU_API_UNAVAILABLE, f"osu! API returned HTTP {response.status_code}", http_status=503)
        try:
            data = response.json()
        except ValueError as exc:
            raise RenderError(ErrorCode.OSU_API_UNAVAILABLE, "osu! API returned invalid JSON", http_status=503) from exc
        return normalize_score(data, reference.score_id)

    async def download_replay(self, score_id: int, ruleset: str) -> bytes:
        response = await self._get(f"/api/v2/scores/{ruleset}/{score_id}/download", accept="application/octet-stream")
        if response.status_code in {404, 410, 422}:
            raise RenderError(ErrorCode.REPLAY_UNAVAILABLE, "Replay is unavailable", http_status=404)
        if response.status_code != 200:
            raise RenderError(ErrorCode.OSU_API_UNAVAILABLE, f"Replay download returned HTTP {response.status_code}", http_status=503)
        if not response.content:
            raise RenderError(ErrorCode.REPLAY_UNAVAILABLE, "Replay is empty", http_status=404)
        return response.content

    async def lookup_beatmap(self, checksum: str) -> ScoreMetadata:
        checksum = checksum.strip().lower()
        if not re.fullmatch(r"[0-9a-f]{32}", checksum):
            raise RenderError(ErrorCode.INVALID_REPLAY, "Replay beatmap checksum is invalid")
        response = await self._get(f"/api/v2/beatmaps/lookup?checksum={quote(checksum)}")
        if response.status_code == 404:
            raise RenderError(ErrorCode.BEATMAP_NOT_FOUND, "Beatmap checksum is unknown to osu!", http_status=404)
        if response.status_code != 200:
            raise RenderError(ErrorCode.OSU_API_UNAVAILABLE, f"Beatmap lookup returned HTTP {response.status_code}", http_status=503)
        try:
            data = response.json()
        except ValueError as exc:
            raise RenderError(ErrorCode.OSU_API_UNAVAILABLE, "Beatmap lookup returned invalid JSON", http_status=503) from exc
        beatmapset = data.get("beatmapset") if isinstance(data.get("beatmapset"), dict) else {}
        mode = str(data.get("mode") or "osu").lower()
        if mode == "catch":
            mode = "fruits"
        return ScoreMetadata(
            beatmap_id=_int_or_none(data.get("id")),
            beatmapset_id=_int_or_none(data.get("beatmapset_id") or beatmapset.get("id")),
            artist=str(beatmapset.get("artist_unicode") or beatmapset.get("artist")) if beatmapset else None,
            title=str(beatmapset.get("title_unicode") or beatmapset.get("title")) if beatmapset else None,
            difficulty=str(data.get("version")) if data.get("version") is not None else None,
            mapper=str(beatmapset.get("creator")) if beatmapset.get("creator") is not None else None,
            ruleset=mode,
        )


def _int_or_none(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _float_or_none(value: Any) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _mods(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    result: list[str] = []
    for item in value:
        acronym = item if isinstance(item, str) else item.get("acronym") if isinstance(item, dict) else None
        if isinstance(acronym, str) and acronym and len(acronym) <= 8:
            result.append(acronym.upper())
    return result


def normalize_score(data: dict[str, Any], fallback_score_id: int) -> ScoreMetadata:
    beatmap = data.get("beatmap") if isinstance(data.get("beatmap"), dict) else {}
    beatmapset = data.get("beatmapset") if isinstance(data.get("beatmapset"), dict) else {}
    if not beatmapset and isinstance(beatmap.get("beatmapset"), dict):
        beatmapset = beatmap["beatmapset"]
    user = data.get("user") if isinstance(data.get("user"), dict) else {}
    statistics = data.get("statistics") if isinstance(data.get("statistics"), dict) else {}

    ruleset_raw = data.get("ruleset") or data.get("mode")
    if isinstance(ruleset_raw, dict):
        ruleset_raw = ruleset_raw.get("short_name") or ruleset_raw.get("name")
    ruleset = str(ruleset_raw).lower() if ruleset_raw else RULESET_BY_ID.get(_int_or_none(data.get("ruleset_id")) or 0, "osu")
    if ruleset == "catch":
        ruleset = "fruits"

    score_value = data.get("legacy_total_score")
    if score_value is None:
        score_value = data.get("total_score", data.get("score"))
    miss = statistics.get("miss")
    if miss is None:
        miss = statistics.get("count_miss", data.get("count_miss"))

    return ScoreMetadata(
        score_id=_int_or_none(data.get("id")) or fallback_score_id,
        player_name=str(user.get("username")) if user.get("username") is not None else None,
        user_id=_int_or_none(user.get("id") or data.get("user_id")),
        beatmap_id=_int_or_none(beatmap.get("id") or data.get("beatmap_id")),
        beatmapset_id=_int_or_none(beatmapset.get("id") or beatmap.get("beatmapset_id")),
        artist=str(beatmapset.get("artist_unicode") or beatmapset.get("artist")) if beatmapset else None,
        title=str(beatmapset.get("title_unicode") or beatmapset.get("title")) if beatmapset else None,
        difficulty=str(beatmap.get("version")) if beatmap.get("version") is not None else None,
        mapper=str(beatmapset.get("creator")) if beatmapset.get("creator") is not None else None,
        ruleset=ruleset,
        mods=_mods(data.get("mods")),
        score=_int_or_none(score_value),
        accuracy=_float_or_none(data.get("accuracy")),
        max_combo=_int_or_none(data.get("max_combo")),
        miss_count=_int_or_none(miss),
        ended_at=str(data.get("ended_at") or data.get("created_at")) if data.get("ended_at") or data.get("created_at") else None,
        has_replay=bool(data.get("has_replay")) if data.get("has_replay") is not None else None,
    )
