from __future__ import annotations

import argparse
import asyncio
import json
import re
from pathlib import Path

from .config import settings
from .osu_api import OsuApiClient
from .score_resolver import ScoreReference
from .youtube_archive import YouTubeArchive
from .youtube_uploader import YouTubeUploadResult, YouTubeUploader, youtube_title


JOB_ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")
VIDEO_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{6,32}$")


def assignments(values: list[str], *, numeric: bool) -> dict[str, int | str]:
    result: dict[str, int | str] = {}
    for value in values:
        job_id, separator, raw = value.partition("=")
        if not separator or not JOB_ID_PATTERN.fullmatch(job_id):
            raise SystemExit(f"Invalid assignment: {value}")
        if numeric:
            if not raw.isdigit():
                raise SystemExit(f"Invalid score id: {value}")
            result[job_id] = int(raw)
        else:
            if not VIDEO_ID_PATTERN.fullmatch(raw):
                raise SystemExit(f"Invalid video id: {value}")
            result[job_id] = raw
    return result


async def run(score_values: list[str], existing_values: list[str], existing_privacy: str) -> int:
    scores = assignments(score_values, numeric=True)
    existing = assignments(existing_values, numeric=False)
    archive = YouTubeArchive(settings)
    uploader = YouTubeUploader(settings)
    if not uploader.configured:
        raise SystemExit("YouTube upload is not configured")

    outputs = sorted(settings.output_path.glob("*.mp4"), key=lambda path: path.stat().st_mtime)
    osu = OsuApiClient(settings.osu_client_id, settings.osu_client_secret)
    metadata_cache = {}
    failures: list[dict[str, str]] = []
    completed: list[dict[str, object]] = []
    try:
        for output in outputs:
            job_id = output.stem
            if not JOB_ID_PATTERN.fullmatch(job_id):
                continue
            recorded = archive.get(job_id)
            if recorded:
                cleanup_errors = await archive.cleanup(job_id, output) if settings.youtube_delete_after_upload else []
                completed.append({"job_id": job_id, "url": recorded.get("url"), "already_recorded": True, "cleanup_errors": cleanup_errors})
                continue
            score_id = scores.get(job_id)
            if not isinstance(score_id, int):
                failures.append({"job_id": job_id, "error": "score id mapping is missing"})
                continue
            try:
                metadata = metadata_cache.get(score_id)
                if metadata is None:
                    metadata = await osu.get_score(ScoreReference(score_id=score_id, ruleset_hint="osu"))
                    metadata_cache[score_id] = metadata
                source_size = output.stat().st_size
                video_id = existing.get(job_id)
                if isinstance(video_id, str):
                    result = YouTubeUploadResult(
                        video_id=video_id,
                        url=f"https://youtu.be/{video_id}",
                        title=youtube_title(metadata),
                        privacy_status=existing_privacy,
                    )
                else:
                    def progress(percent: int, current: str = job_id) -> None:
                        print(f"UPLOAD {current} {percent}%", flush=True)

                    result = await uploader.upload(output, metadata, progress)
                await archive.record(job_id, result, metadata, source_size)
                cleanup_errors = await archive.cleanup(job_id, output) if settings.youtube_delete_after_upload else []
                completed.append({
                    "job_id": job_id,
                    "score_id": score_id,
                    "url": result.url,
                    "title": result.title,
                    "privacy": result.privacy_status,
                    "existing": isinstance(video_id, str),
                    "cleanup_errors": cleanup_errors,
                })
                print(json.dumps(completed[-1], ensure_ascii=True), flush=True)
            except Exception as exc:
                failures.append({"job_id": job_id, "error": str(exc)[:500]})
                print(json.dumps(failures[-1], ensure_ascii=True), flush=True)
    finally:
        await osu.close()

    print(json.dumps({"completed": completed, "failures": failures}, ensure_ascii=True), flush=True)
    return 1 if failures else 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Upload historical renderer MP4 files to YouTube exactly once")
    parser.add_argument("--score", action="append", default=[], metavar="JOB_ID=SCORE_ID")
    parser.add_argument("--existing", action="append", default=[], metavar="JOB_ID=VIDEO_ID")
    parser.add_argument("--existing-privacy", choices=("private", "unlisted", "public"), default="unlisted")
    args = parser.parse_args()
    return asyncio.run(run(args.score, args.existing, args.existing_privacy))


if __name__ == "__main__":
    raise SystemExit(main())
