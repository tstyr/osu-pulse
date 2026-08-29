from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Windows adapter for the local osu!mania renderer")
    parser.add_argument("replay", type=Path, nargs="?")
    parser.add_argument("beatmap_dir", type=Path, nargs="?")
    parser.add_argument("-o", "--output", type=Path)
    parser.add_argument("--source-path", type=Path, required=True)
    parser.add_argument("--skin-dir", type=Path)
    parser.add_argument("--resolution", default="1920x1080")
    parser.add_argument("--fps", type=int, default=60)
    parser.add_argument("--encoder", choices=("h264_nvenc", "h264_amf", "libx264"), default="libx264")
    parser.add_argument("--timeout", type=int, default=1800)
    parser.add_argument("--scroll-speed", type=int, default=30)
    parser.add_argument("--judgment-scale", type=float, default=0.58)
    parser.add_argument("--score-scale", type=float, default=1.35)
    parser.add_argument("--combo-scale", type=float, default=1.35)
    parser.add_argument("--probe", action="store_true")
    return parser


def _load_engine(source_path: Path):
    package = source_path.resolve() / "osu_mania_renderer_v2" / "__init__.py"
    if not package.is_file():
        raise RuntimeError(f"osu!mania renderer source is missing: {source_path}")
    sys.path.insert(0, str(source_path.resolve()))

    import moderngl

    if os.name == "nt":
        create_standalone_context = moderngl.create_standalone_context

        def create_windows_context(*args, **kwargs):
            if kwargs.get("backend") == "egl":
                kwargs.pop("backend")
            return create_standalone_context(*args, **kwargs)

        moderngl.create_standalone_context = create_windows_context

    from osu_mania_renderer_v2 import RenderOptions, render_mania
    from osu_mania_renderer_v2.gpu.context import HeadlessGl

    if os.name == "nt":
        from osu_mania_renderer_v2.render import encode

        # Upstream only catches Linux pipe-resize syscall failures, while
        # importing fcntl itself fails on Windows. Pipe growth is optional.
        encode._grow_pipe = lambda _fd: None

    return RenderOptions, render_mania, HeadlessGl


async def _render(args: argparse.Namespace, RenderOptions, render_mania) -> None:
    if not args.replay or not args.beatmap_dir or not args.output:
        raise ValueError("replay, beatmap_dir, and output are required")
    width, height = (int(value) for value in args.resolution.lower().split("x", 1))
    options = RenderOptions(
        resolution=(width, height),
        fps=args.fps,
        encoder=args.encoder,
        timeout_seconds=args.timeout,
        scroll_speed=max(1, min(40, args.scroll_speed)),
        judgment_scale=max(0.25, min(1.5, args.judgment_scale)),
        score_scale=max(0.5, min(2.5, args.score_scale)),
        combo_scale=max(0.5, min(2.5, args.combo_scale)),
    )

    async def progress(fraction: float) -> None:
        print(f"Progress: {max(0, min(100, round(fraction * 100)))}%", flush=True)

    await render_mania(
        osr_path=args.replay,
        beatmap_dir=args.beatmap_dir,
        output_path=args.output,
        options=options,
        progress_callback=progress,
        skin_dir=args.skin_dir,
    )


def main() -> int:
    args = _parser().parse_args()
    try:
        RenderOptions, render_mania, HeadlessGl = _load_engine(args.source_path)
        if args.probe:
            with HeadlessGl(1, 1) as context:
                print(f"GPU: {context.ctx.info.get('GL_RENDERER', 'unknown')}")
            return 0
        asyncio.run(_render(args, RenderOptions, render_mania))
        return 0
    except Exception as error:
        import traceback

        print(f"error: {error}", file=sys.stderr, flush=True)
        traceback.print_exc(file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
