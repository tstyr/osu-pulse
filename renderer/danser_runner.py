from __future__ import annotations

import asyncio
import errno
import json
import logging
import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from .config import Settings
from .errors import ErrorCode, RenderCancelled, RenderError
from .models import JobStatus, RenderJob
from .prerequisites import DependencyState, executable_exists


LOGGER = logging.getLogger("renderer.danser")
PROGRESS_PATTERN = re.compile(r"(?<![0-9])(100|[0-9]{1,2})(?:\.[0-9]+)?\s*%")
NVENC_FAILURE_PATTERN = re.compile(r"nvenc|no capable devices|cannot load.*cuda|encoder.*not found", re.IGNORECASE)


class DanserRunner:
    def __init__(self, settings: Settings, dependencies: DependencyState) -> None:
        self.settings = settings
        self.dependencies = dependencies

    async def render(self, job: RenderJob, replay_path: Path) -> Path:
        if not executable_exists(self.settings.danser_path):
            raise RenderError(ErrorCode.DANSER_NOT_FOUND, "danser executable was not found", http_status=503)
        if not executable_exists(self.settings.ffmpeg_path):
            raise RenderError(ErrorCode.FFMPEG_NOT_FOUND, "FFmpeg executable was not found", http_status=503)
        if not self.settings.songs_path.is_dir():
            raise RenderError(ErrorCode.BEATMAP_NOT_FOUND, "osu! Songs directory was not found", http_status=503)

        encoder = self._encoder()
        return_code, output_lines = await self._run_once(job, replay_path, encoder)
        if return_code == 0:
            return self._verify_output(job)

        combined = "\n".join(output_lines[-100:])
        if encoder == "h264_nvenc" and self.settings.video_encoder == "auto" and NVENC_FAILURE_PATTERN.search(combined):
            LOGGER.warning("job=%s NVENC failed; retrying with libx264", job.id)
            self._remove_partial_output(job.id)
            job.update(JobStatus.RENDERING, 1, "NVENC unavailable; retrying with CPU encoder")
            return_code, output_lines = await self._run_once(job, replay_path, "libx264")
            if return_code == 0:
                return self._verify_output(job)

        detail = self._safe_failure_detail(output_lines)
        raise RenderError(ErrorCode.DANSER_CRASHED, detail or f"danser exited with code {return_code}")

    def _encoder(self) -> str:
        if self.settings.video_encoder == "auto":
            return "h264_nvenc" if self.dependencies.nvenc else "libx264"
        if self.settings.video_encoder == "h264_nvenc" and not self.dependencies.nvenc:
            raise RenderError(ErrorCode.FFMPEG_NOT_FOUND, "h264_nvenc is configured but unavailable", http_status=503)
        return self.settings.video_encoder

    def _command(self, job: RenderJob, replay_path: Path, encoder: str) -> list[str]:
        width, height = job.options.size
        settings_patch = {
            "General": {
                "OsuSongsDir": str(self.settings.songs_path),
                "DiscordPresenceOn": False,
                "UnpackOszFiles": False,
            },
            "Recording": {
                "FrameWidth": width,
                "FrameHeight": height,
                "FPS": job.options.fps,
                "Encoder": encoder,
                "OutputDir": str(self.settings.output_path),
                "Container": "mp4",
                "ShowFFmpegLogs": True,
                "MotionBlur": {
                    "Enabled": job.options.motion_blur,
                    "OversampleMultiplier": 8,
                    "BlendFrames": 12,
                    "BlendFunctionID": 27,
                    "GaussWeightsMult": 1.5,
                },
            },
        }
        command = [
            str(self.settings.danser_path),
            f"-replay={replay_path.as_posix()}",
            "-record",
            f"-out={job.id}",
            f"-settings={self.settings.danser_settings}",
            "-noupdatecheck",
            "-preciseprogress",
            f"-sPatch={json.dumps(settings_patch, ensure_ascii=False, separators=(',', ':'))}",
        ]
        if job.options.speed_multiplier is not None:
            command.append(f"-speed={job.options.speed_multiplier:g}")
        return command

    async def _run_once(self, job: RenderJob, replay_path: Path, encoder: str) -> tuple[int, list[str]]:
        command = self._command(job, replay_path, encoder)
        env = os.environ.copy()
        ffmpeg_parent = str(self.settings.ffmpeg_path.parent) if self.settings.ffmpeg_path else ""
        if ffmpeg_parent:
            env["PATH"] = ffmpeg_parent + os.pathsep + env.get("PATH", "")
        creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) if os.name == "nt" else 0
        job.render_started_at = job.render_started_at or datetime.now(timezone.utc)
        job.update(JobStatus.RENDERING, max(job.progress, 1), f"Starting danser with {encoder}")

        try:
            process = await asyncio.create_subprocess_exec(
                *command,
                cwd=str(self.settings.danser_path.parent),
                env=env,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                creationflags=creationflags,
            )
        except FileNotFoundError as exc:
            raise RenderError(ErrorCode.DANSER_NOT_FOUND, "danser executable was not found", http_status=503) from exc
        except OSError as exc:
            code = ErrorCode.DISK_FULL if exc.errno == errno.ENOSPC else ErrorCode.DANSER_CRASHED
            raise RenderError(code, "Could not start danser") from exc

        job.process = process
        LOGGER.info("job=%s pid=%s render_start encoder=%s", job.id, process.pid, encoder)
        lines: list[str] = []
        reader_task = asyncio.create_task(self._read_output(job, process, lines))
        wait_task = asyncio.create_task(process.wait())
        cancel_task = asyncio.create_task(job.cancel_requested.wait())
        try:
            done, _ = await asyncio.wait(
                {wait_task, cancel_task},
                timeout=self.settings.render_timeout_seconds,
                return_when=asyncio.FIRST_COMPLETED,
            )
            if not done:
                await self._terminate_tree(process)
                raise RenderError(ErrorCode.RENDER_TIMEOUT, "Render timed out")
            if cancel_task in done and job.cancel_requested.is_set():
                await self._terminate_tree(process)
                raise RenderCancelled()
            return_code = await wait_task
            await reader_task
            LOGGER.info("job=%s pid=%s exit_code=%s", job.id, process.pid, return_code)
            return return_code, lines
        except asyncio.CancelledError:
            await self._terminate_tree(process)
            raise
        finally:
            for task in (reader_task, wait_task, cancel_task):
                if not task.done():
                    task.cancel()
            await asyncio.gather(reader_task, wait_task, cancel_task, return_exceptions=True)
            job.process = None

    async def _read_output(self, job: RenderJob, process: asyncio.subprocess.Process, lines: list[str]) -> None:
        if not process.stdout:
            return
        log_path = self.settings.log_path / f"{job.id}.log"
        with log_path.open("a", encoding="utf-8", errors="replace") as log_file:
            while line := await process.stdout.readline():
                decoded = line.decode("utf-8", errors="replace").rstrip()
                lines.append(decoded)
                if len(lines) > 500:
                    del lines[:100]
                log_file.write(decoded + "\n")
                match = PROGRESS_PATTERN.search(decoded)
                if match:
                    percentage = int(match.group(1))
                    if percentage >= 90:
                        job.update(JobStatus.ENCODING, min(99, percentage), decoded)
                    else:
                        job.update(JobStatus.RENDERING, max(1, percentage), decoded)

    async def _terminate_tree(self, process: asyncio.subprocess.Process) -> None:
        if process.returncode is not None:
            return
        if os.name == "nt":
            killer = await asyncio.create_subprocess_exec(
                "taskkill", "/PID", str(process.pid), "/T", "/F",
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            try:
                await asyncio.wait_for(killer.wait(), timeout=10)
            except asyncio.TimeoutError:
                killer.kill()
        else:
            process.terminate()
        try:
            await asyncio.wait_for(process.wait(), timeout=10)
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()

    def _verify_output(self, job: RenderJob) -> Path:
        output = (self.settings.output_path / f"{job.id}.mp4").resolve()
        if not output.is_relative_to(self.settings.output_path.resolve()) or not output.is_file() or output.stat().st_size == 0:
            raise RenderError(ErrorCode.FFMPEG_CRASHED, "danser finished without producing an MP4")
        return output

    def _remove_partial_output(self, job_id: str) -> None:
        output = (self.settings.output_path / f"{job_id}.mp4").resolve()
        if output.is_relative_to(self.settings.output_path.resolve()):
            output.unlink(missing_ok=True)

    @staticmethod
    def _safe_failure_detail(lines: list[str]) -> str:
        for line in reversed(lines):
            value = line.strip()
            if value and not value.lower().startswith(("authorization", "access_token")):
                return value[:500]
        return ""
