from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Callable
from urllib.parse import urlsplit

import httpx

from .config import Settings
from .models import ScoreMetadata


LOGGER = logging.getLogger("renderer.youtube")
TOKEN_URL = "https://oauth2.googleapis.com/token"
UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos"
VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos"
VIDEO_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{6,32}$")
RANGE_PATTERN = re.compile(r"(?:bytes=)?0-([0-9]+)$")
TRANSIENT_STATUS_CODES = {500, 502, 503, 504}
RANK_LABELS = {"X": "SS", "XH": "SSH"}


class YouTubeUploadError(Exception):
    pass


@dataclass(frozen=True, slots=True)
class YouTubeUploadResult:
    video_id: str
    url: str
    title: str
    privacy_status: str


def _clean(value: str | None, fallback: str) -> str:
    cleaned = " ".join((value or "").split()).strip()
    return cleaned or fallback


def _fallback_rank(accuracy: float | None) -> str:
    if accuracy is None:
        return "—"
    if accuracy >= 1:
        return "SS"
    if accuracy >= 0.95:
        return "S"
    if accuracy >= 0.9:
        return "A"
    if accuracy >= 0.8:
        return "B"
    if accuracy >= 0.7:
        return "C"
    return "D"


def youtube_title(metadata: ScoreMetadata) -> str:
    rank = RANK_LABELS.get((metadata.rank or "").upper(), (metadata.rank or "").upper()) or _fallback_rank(metadata.accuracy)
    pp = f"{metadata.pp:.1f}pp" if metadata.pp is not None else "—pp"
    accuracy = f"{metadata.accuracy * 100:.2f}%" if metadata.accuracy is not None else "—%"
    artist = _clean(metadata.artist, "Unknown Artist")
    song = _clean(metadata.title, "Unknown Song")
    difficulty = f" [{_clean(metadata.difficulty, '')}]" if metadata.difficulty else ""
    return f"{rank} | {pp} | {accuracy} | {artist} - {song}{difficulty}"[:100]


def youtube_description(metadata: ScoreMetadata) -> str:
    mode = "osu!mania" if metadata.ruleset == "mania" else "osu!standard"
    mods = "+" + "".join(metadata.mods) if metadata.mods else "No Mod"
    score_url = f"https://osu.ppy.sh/scores/{metadata.score_id}" if metadata.score_id else None
    lines = [
        f"Player: {_clean(metadata.player_name, 'Unknown')}",
        f"Mode: {mode}",
        f"Map: {_clean(metadata.artist, 'Unknown Artist')} - {_clean(metadata.title, 'Unknown Song')}",
        f"Difficulty: {_clean(metadata.difficulty, 'Unknown')}",
        f"Mods: {mods}",
    ]
    if score_url:
        lines.extend([f"Result: {score_url}", ""])
    lines.append("Rendered automatically by osu! Pulse.")
    return "\n".join(lines)[:5000]


class YouTubeUploader:
    def __init__(self, settings: Settings, *, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.settings = settings
        self._transport = transport

    @property
    def configured(self) -> bool:
        return bool(
            self.settings.youtube_auto_upload
            and self.settings.youtube_client_id
            and self.settings.youtube_refresh_token
        )

    @property
    def credentials_configured(self) -> bool:
        return bool(self.settings.youtube_client_id and self.settings.youtube_refresh_token)

    async def delete_video(self, video_id: str) -> None:
        if not self.credentials_configured:
            raise YouTubeUploadError("YouTube OAuth is not configured")
        if not VIDEO_ID_PATTERN.fullmatch(video_id):
            raise YouTubeUploadError("YouTube video ID is invalid")
        timeout = httpx.Timeout(connect=30, read=60, write=60, pool=30)
        try:
            async with httpx.AsyncClient(timeout=timeout, transport=self._transport, follow_redirects=False) as client:
                token = await self._access_token(client)
                response = await client.delete(
                    VIDEOS_URL,
                    params={"id": video_id},
                    headers={"Authorization": f"Bearer {token}"},
                )
                if response.status_code not in {204, 404}:
                    raise YouTubeUploadError(f"YouTube delete failed: {self._error_detail(response)}")
        except httpx.HTTPError as exc:
            raise YouTubeUploadError("YouTube delete connection failed") from exc

    async def upload(
        self,
        video_path: Path,
        metadata: ScoreMetadata,
        progress: Callable[[int], None] | None = None,
    ) -> YouTubeUploadResult:
        if not self.configured:
            raise YouTubeUploadError("YouTube OAuth is not configured")
        source = video_path.resolve()
        if not source.is_relative_to(self.settings.output_path.resolve()) or not source.is_file():
            raise YouTubeUploadError("YouTube upload source is unavailable")
        if source.stat().st_size <= 0:
            raise YouTubeUploadError("YouTube upload source is empty")
        try:
            return await asyncio.wait_for(
                self._upload(source, metadata, progress),
                timeout=self.settings.youtube_upload_timeout_seconds,
            )
        except asyncio.TimeoutError as exc:
            raise YouTubeUploadError("YouTube upload timed out") from exc
        except (httpx.HTTPError, OSError) as exc:
            raise YouTubeUploadError("YouTube upload connection failed") from exc

    async def _upload(
        self,
        source: Path,
        metadata: ScoreMetadata,
        progress: Callable[[int], None] | None,
    ) -> YouTubeUploadResult:
        timeout = httpx.Timeout(connect=30, read=300, write=300, pool=30)
        async with httpx.AsyncClient(timeout=timeout, transport=self._transport, follow_redirects=False) as client:
            token = await self._access_token(client)
            title = youtube_title(metadata)
            total = source.stat().st_size
            session_url = await self._start_session(client, token, total, title, metadata)
            result = await self._send_file(client, token, session_url, source, total, title, progress)
            LOGGER.info(
                "youtube upload completed video_id=%s privacy=%s bytes=%s",
                result.video_id,
                result.privacy_status,
                total,
            )
            return result

    async def _access_token(self, client: httpx.AsyncClient) -> str:
        form = {
            "client_id": self.settings.youtube_client_id or "",
            "refresh_token": self.settings.youtube_refresh_token or "",
            "grant_type": "refresh_token",
        }
        if self.settings.youtube_client_secret:
            form["client_secret"] = self.settings.youtube_client_secret
        response = await client.post(TOKEN_URL, data=form)
        if response.status_code != 200:
            raise YouTubeUploadError(f"YouTube OAuth refresh failed: {self._error_detail(response)}")
        try:
            payload = response.json()
        except ValueError as exc:
            raise YouTubeUploadError("YouTube OAuth returned invalid JSON") from exc
        token = payload.get("access_token") if isinstance(payload, dict) else None
        if not isinstance(token, str) or not token:
            raise YouTubeUploadError("YouTube OAuth returned no access token")
        return token

    async def _start_session(
        self,
        client: httpx.AsyncClient,
        token: str,
        total: int,
        title: str,
        metadata: ScoreMetadata,
    ) -> str:
        body = {
            "snippet": {
                "title": title,
                "description": youtube_description(metadata),
                "tags": ["osu!", "osu! replay", metadata.ruleset, "osu! Pulse"],
                "categoryId": self.settings.youtube_category_id,
            },
            "status": {
                "privacyStatus": self.settings.youtube_privacy_status,
                "embeddable": True,
                "license": "youtube",
            },
        }
        response = await client.post(
            UPLOAD_URL,
            params={"uploadType": "resumable", "part": "snippet,status", "notifySubscribers": "false"},
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json; charset=UTF-8",
                "X-Upload-Content-Length": str(total),
                "X-Upload-Content-Type": "video/mp4",
            },
            json=body,
        )
        if response.status_code != 200:
            raise YouTubeUploadError(f"YouTube upload session failed: {self._error_detail(response)}")
        location = response.headers.get("location")
        if not location or not self._safe_session_url(location):
            raise YouTubeUploadError("YouTube returned an invalid upload session URL")
        return location

    async def _send_file(
        self,
        client: httpx.AsyncClient,
        token: str,
        session_url: str,
        source: Path,
        total: int,
        title: str,
        progress: Callable[[int], None] | None,
    ) -> YouTubeUploadResult:
        offset = 0
        failures = 0
        with source.open("rb") as video:
            while offset < total:
                video.seek(offset)
                chunk = await asyncio.to_thread(video.read, min(self.settings.youtube_chunk_bytes, total - offset))
                if not chunk:
                    raise YouTubeUploadError("YouTube upload source ended unexpectedly")
                end = offset + len(chunk) - 1
                try:
                    response = await client.put(
                        session_url,
                        headers={
                            "Authorization": f"Bearer {token}",
                            "Content-Type": "video/mp4",
                            "Content-Length": str(len(chunk)),
                            "Content-Range": f"bytes {offset}-{end}/{total}",
                        },
                        content=chunk,
                    )
                except httpx.TransportError as exc:
                    failures += 1
                    if failures > 5:
                        raise YouTubeUploadError("YouTube upload connection repeatedly failed") from exc
                    await asyncio.sleep(min(2 ** failures, 16))
                    offset, completed = await self._resume_offset(client, token, session_url, total, title)
                    if completed:
                        return completed
                    continue

                if response.status_code in {200, 201}:
                    return self._result(response, title)
                if response.status_code == 308:
                    offset = self._next_offset(response, end + 1)
                    failures = 0
                    if progress:
                        progress(min(100, round(offset / total * 100)))
                    continue
                if response.status_code in TRANSIENT_STATUS_CODES:
                    failures += 1
                    if failures > 5:
                        raise YouTubeUploadError(f"YouTube upload failed repeatedly: HTTP {response.status_code}")
                    await asyncio.sleep(min(2 ** failures, 16))
                    offset, completed = await self._resume_offset(client, token, session_url, total, title)
                    if completed:
                        return completed
                    continue
                raise YouTubeUploadError(f"YouTube upload failed: {self._error_detail(response)}")

        _, completed = await self._resume_offset(client, token, session_url, total, title)
        if completed:
            return completed
        raise YouTubeUploadError("YouTube did not confirm the completed upload")

    async def _resume_offset(
        self,
        client: httpx.AsyncClient,
        token: str,
        session_url: str,
        total: int,
        title: str,
    ) -> tuple[int, YouTubeUploadResult | None]:
        response = await client.put(
            session_url,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Length": "0",
                "Content-Range": f"bytes */{total}",
            },
            content=b"",
        )
        if response.status_code in {200, 201}:
            return total, self._result(response, title)
        if response.status_code != 308:
            raise YouTubeUploadError(f"YouTube upload resume failed: {self._error_detail(response)}")
        return self._next_offset(response, 0), None

    def _result(self, response: httpx.Response, title: str) -> YouTubeUploadResult:
        try:
            payload = response.json()
        except ValueError as exc:
            raise YouTubeUploadError("YouTube upload returned invalid JSON") from exc
        video_id = payload.get("id") if isinstance(payload, dict) else None
        status = payload.get("status") if isinstance(payload, dict) and isinstance(payload.get("status"), dict) else {}
        privacy = status.get("privacyStatus") or self.settings.youtube_privacy_status
        if not isinstance(video_id, str) or not VIDEO_ID_PATTERN.fullmatch(video_id):
            raise YouTubeUploadError("YouTube upload returned an invalid video ID")
        if not isinstance(privacy, str) or privacy not in {"private", "unlisted", "public"}:
            privacy = self.settings.youtube_privacy_status
        return YouTubeUploadResult(video_id, f"https://youtu.be/{video_id}", title, privacy)

    @staticmethod
    def _next_offset(response: httpx.Response, fallback: int) -> int:
        value = response.headers.get("range", "")
        match = RANGE_PATTERN.fullmatch(value.strip())
        return int(match.group(1)) + 1 if match else fallback

    @staticmethod
    def _safe_session_url(value: str) -> bool:
        parsed = urlsplit(value)
        host = (parsed.hostname or "").lower()
        return bool(
            parsed.scheme == "https"
            and (host == "www.googleapis.com" or host.endswith(".googleapis.com"))
            and not parsed.username
            and not parsed.password
            and parsed.path.startswith("/upload/")
        )

    @staticmethod
    def _error_detail(response: httpx.Response) -> str:
        try:
            payload = response.json()
            error = payload.get("error") if isinstance(payload, dict) else None
            if isinstance(error, dict) and isinstance(error.get("message"), str):
                return f"HTTP {response.status_code}: {error['message'][:300]}"
            if isinstance(error, str):
                return f"HTTP {response.status_code}: {error[:300]}"
        except (ValueError, json.JSONDecodeError):
            pass
        return f"HTTP {response.status_code}"
