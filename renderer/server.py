from __future__ import annotations

import asyncio
import hmac
import json
import logging
import re
from contextlib import asynccontextmanager
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path
from typing import Any, AsyncIterator

import uvicorn
from fastapi import Depends, FastAPI, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from starlette.datastructures import UploadFile as StarletteUploadFile

from .beatmap_index import BeatmapIndex
from .beatmap_resolver import BeatmapResolver
from .config import Settings, settings as default_settings
from .cloud_bridge import CloudRenderBridge
from .danser_runner import DanserRunner
from .errors import ErrorCode, RenderError
from .jobs import JobManager
from .osu_api import OsuApiClient
from .prerequisites import DependencyState, inspect_dependencies
from .render_options import RenderOptions


JOB_ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")
USER_ID_PATTERN = re.compile(r"^[0-9]{1,32}$")


def configure_logging(settings: Settings) -> TimedRotatingFileHandler | None:
    settings.ensure_directories()
    root = logging.getLogger()
    if any(getattr(handler, "_osu_renderer", False) for handler in root.handlers):
        return None
    handler = TimedRotatingFileHandler(settings.log_path / "renderer.log", when="midnight", backupCount=14, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    handler._osu_renderer = True  # type: ignore[attr-defined]
    root.addHandler(handler)
    root.setLevel(logging.INFO)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    return handler


def create_app(settings: Settings = default_settings) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        file_handler = configure_logging(settings)
        dependencies = await inspect_dependencies(settings)
        beatmap_index = BeatmapIndex(settings.songs_path, settings.beatmap_index_path)
        try:
            count = await asyncio.to_thread(beatmap_index.rebuild)
            dependencies.songs_index_ready = beatmap_index.ready
            dependencies.songs_index_count = count
            dependencies.songs_index_error = beatmap_index.last_error
        except Exception as exc:
            logging.getLogger("renderer.server").exception("Beatmap indexing failed")
            dependencies.songs_index_error = str(exc)[:200]
        osu_api = OsuApiClient(settings.osu_client_id, settings.osu_client_secret)
        manager = JobManager(settings, osu_api, BeatmapResolver(beatmap_index), DanserRunner(settings, dependencies))
        await manager.start()
        cloud_bridge = CloudRenderBridge(settings, manager, dependencies)
        await cloud_bridge.start()
        app.state.settings = settings
        app.state.dependencies = dependencies
        app.state.beatmap_index = beatmap_index
        app.state.osu_api = osu_api
        app.state.jobs = manager
        app.state.cloud_bridge = cloud_bridge
        print_startup_summary(settings, dependencies)
        try:
            yield
        finally:
            await cloud_bridge.stop()
            await manager.stop()
            await osu_api.close()
            if file_handler:
                logging.getLogger().removeHandler(file_handler)
                file_handler.close()

    app = FastAPI(title="osu! Local Rendering Server", version="1.0.0", lifespan=lifespan)

    @app.exception_handler(RenderError)
    async def render_error_handler(_request: Request, exc: RenderError) -> JSONResponse:
        return JSONResponse(status_code=exc.http_status, content={"error_code": exc.code.value, "error": exc.message})

    async def authorize(request: Request) -> None:
        expected = settings.server_token
        if not expected:
            return
        supplied = request.headers.get("authorization", "")
        prefix = "Bearer "
        if not supplied.startswith(prefix) or not hmac.compare_digest(supplied[len(prefix):], expected):
            raise RenderError(ErrorCode.UNAUTHORIZED, "Invalid renderer token", http_status=401)

    @app.get("/health", dependencies=[Depends(authorize)])
    async def health(request: Request) -> dict[str, Any]:
        manager: JobManager = request.app.state.jobs
        dependencies: DependencyState = request.app.state.dependencies
        return {
            "status": dependencies.status,
            "busy": manager.active_count > 0,
            "queue_size": manager.queue_size,
            "rendering": manager.active_count,
            **dependencies.public_dict(),
        }

    @app.post("/render", status_code=202, dependencies=[Depends(authorize)])
    async def submit_render(request: Request) -> dict[str, str]:
        _check_content_length(request, settings.max_replay_bytes + 1024 * 1024)
        manager: JobManager = request.app.state.jobs
        content_type = request.headers.get("content-type", "").lower()
        if content_type.startswith("application/json"):
            try:
                body = await request.body()
                if len(body) > 64 * 1024:
                    raise RenderError(ErrorCode.INVALID_OPTIONS, "JSON request is too large", http_status=413)
                payload = json.loads(body)
            except RenderError:
                raise
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise RenderError(ErrorCode.INVALID_OPTIONS, "Invalid JSON request") from exc
            if not isinstance(payload, dict) or payload.get("type") != "score_url":
                raise RenderError(ErrorCode.INVALID_OPTIONS, "JSON render type must be score_url")
            user_id = _user_id(payload.get("user_id"))
            options = _options(payload)
            url = payload.get("url")
            if not isinstance(url, str):
                raise RenderError(ErrorCode.INVALID_OSU_URL, "url is required")
            job = await manager.submit_score(user_id, url, options)
        elif content_type.startswith("multipart/form-data"):
            form = await request.form()
            if form.get("type") != "replay":
                raise RenderError(ErrorCode.INVALID_OPTIONS, "Multipart render type must be replay")
            upload = form.get("replay")
            if not isinstance(upload, StarletteUploadFile):
                raise RenderError(ErrorCode.INVALID_REPLAY, "replay attachment is required")
            replay = await _read_upload(upload, settings.max_replay_bytes)
            user_id = _user_id(form.get("user_id"))
            options = _options(form)
            job = await manager.submit_replay(user_id, replay, options)
        else:
            raise RenderError(ErrorCode.INVALID_OPTIONS, "Use application/json or multipart/form-data", http_status=415)
        return {"job_id": job.id}

    @app.get("/jobs/{job_id}", dependencies=[Depends(authorize)])
    async def get_job(job_id: str, request: Request) -> dict[str, Any]:
        _validate_job_id(job_id)
        manager: JobManager = request.app.state.jobs
        return manager.get(job_id).public_dict()

    @app.get("/jobs/{job_id}/video", dependencies=[Depends(authorize)])
    async def get_video(job_id: str, request: Request) -> FileResponse:
        _validate_job_id(job_id)
        manager: JobManager = request.app.state.jobs
        job = manager.get(job_id)
        if job.status.value != "completed" or not job.output_path:
            raise RenderError(ErrorCode.VIDEO_NOT_READY, "Video is not ready", http_status=409)
        path = job.output_path.resolve()
        if not path.is_relative_to(settings.output_path.resolve()) or not path.is_file():
            raise RenderError(ErrorCode.VIDEO_NOT_READY, "Video is no longer available", http_status=410)
        return FileResponse(path, media_type="video/mp4", filename=f"osu-render-{job.id[:8]}.mp4")

    @app.delete("/jobs/{job_id}", dependencies=[Depends(authorize)])
    async def cancel_job(job_id: str, request: Request) -> dict[str, Any]:
        _validate_job_id(job_id)
        manager: JobManager = request.app.state.jobs
        return (await manager.cancel(job_id)).public_dict()

    @app.post("/beatmaps/reindex", dependencies=[Depends(authorize)])
    async def reindex(request: Request) -> dict[str, Any]:
        index: BeatmapIndex = request.app.state.beatmap_index
        dependencies: DependencyState = request.app.state.dependencies
        count = await asyncio.to_thread(index.rebuild)
        dependencies.songs_index_ready = index.ready
        dependencies.songs_index_count = count
        dependencies.songs_index_error = index.last_error
        return {"status": "ready" if index.ready else "failed", "songs_index_count": count, "error": index.last_error}

    return app


def _check_content_length(request: Request, maximum: int) -> None:
    raw = request.headers.get("content-length")
    if not raw:
        return
    try:
        if int(raw) > maximum:
            raise RenderError(ErrorCode.INVALID_REPLAY, "Request body is too large", http_status=413)
    except ValueError as exc:
        raise RenderError(ErrorCode.INVALID_OPTIONS, "Invalid Content-Length") from exc


async def _read_upload(upload: UploadFile, maximum: int) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while chunk := await upload.read(64 * 1024):
        total += len(chunk)
        if total > maximum:
            raise RenderError(ErrorCode.INVALID_REPLAY, "Replay file is too large", http_status=413)
        chunks.append(chunk)
    await upload.close()
    return b"".join(chunks)


def _user_id(value: object) -> str:
    result = str(value or "anonymous")
    if result == "anonymous":
        return result
    if not USER_ID_PATTERN.fullmatch(result):
        raise RenderError(ErrorCode.INVALID_OPTIONS, "Invalid user_id")
    return result


def _options(values: Any) -> RenderOptions:
    getter = values.get
    return RenderOptions.from_values(
        getter("resolution"),
        getter("fps"),
        getter("speed"),
        getter("motion_blur"),
    )


def _validate_job_id(job_id: str) -> None:
    if not JOB_ID_PATTERN.fullmatch(job_id):
        raise RenderError(ErrorCode.JOB_NOT_FOUND, "Job not found", http_status=404)


def print_startup_summary(settings: Settings, dependencies: DependencyState) -> None:
    value = lambda ok: "OK" if ok else "NOT FOUND"
    print("\n==============================================")
    print("          osu! Local Rendering Server")
    print("==============================================\n")
    print(f"Server       : {dependencies.status.upper()}")
    print(f"Address      : http://{settings.host}:{settings.port}\n")
    print(f"danser       : {value(dependencies.danser)}")
    print(f"FFmpeg       : {value(dependencies.ffmpeg)}")
    print(f"osu! Songs   : {value(dependencies.osu_songs)}")
    print(f"osu! API     : {'OK' if dependencies.osu_api else 'MISSING CREDENTIALS'}")
    print(f"GPU Encoder  : {'NVENC' if dependencies.nvenc else 'CPU (libx264)'}")
    print(f"Render Slots : {settings.max_concurrent_renders}\n")
    cloud_ready = bool(settings.cloud_url and settings.cloud_bridge_token and settings.blob_token)
    print(f"Vercel Bridge: {'READY' if cloud_ready else 'NOT CONFIGURED'}")
    if settings.cloud_url:
        print(f"Cloud URL    : {settings.cloud_url}")
    print(f"Songs Index  : {dependencies.songs_index_count:,} beatmaps")
    if dependencies.songs_index_error:
        print(f"Index Error  : {dependencies.songs_index_error}")
    print("\nWaiting for render jobs...\n")


app = create_app()


if __name__ == "__main__":
    # Host is a literal, not an environment-controlled value.
    uvicorn.run(app, host="127.0.0.1", port=default_settings.port, log_level="info")
