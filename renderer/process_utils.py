from __future__ import annotations

import asyncio

import psutil

from .errors import RenderCancelled


async def communicate_with_timeout(
    process: asyncio.subprocess.Process,
    *,
    timeout: float,
    cancel_event: asyncio.Event | None = None,
) -> tuple[bytes | None, bytes | None]:
    """Reap the process and its children when an operation times out or stops."""
    communication = asyncio.create_task(process.communicate())
    cancelled = asyncio.create_task(cancel_event.wait()) if cancel_event else None
    try:
        if cancelled:
            done, _ = await asyncio.wait({communication, cancelled}, timeout=timeout, return_when=asyncio.FIRST_COMPLETED)
            if cancelled in done:
                raise RenderCancelled()
            if communication not in done:
                raise asyncio.TimeoutError()
            return await communication
        return await asyncio.wait_for(asyncio.shield(communication), timeout=timeout)
    except (asyncio.TimeoutError, asyncio.CancelledError, RenderCancelled):
        if process.returncode is None:
            try:
                children = psutil.Process(process.pid).children(recursive=True)
            except psutil.Error:
                children = []
            for child in reversed(children):
                try:
                    child.kill()
                except psutil.Error:
                    pass
            try:
                process.kill()
            except ProcessLookupError:
                pass
        try:
            await asyncio.wait_for(asyncio.shield(communication), timeout=10)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            communication.cancel()
            await asyncio.gather(communication, return_exceptions=True)
        raise
    finally:
        if cancelled:
            cancelled.cancel()
            await asyncio.gather(cancelled, return_exceptions=True)
