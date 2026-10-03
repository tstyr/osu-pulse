from __future__ import annotations

import asyncio
import sys
import unittest

import psutil

from renderer.errors import RenderCancelled
from renderer.process_utils import communicate_with_timeout


class ProcessLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def test_success_preserves_process_output(self) -> None:
        process = await asyncio.create_subprocess_exec(
            sys.executable, "-c", "print('done')",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await communicate_with_timeout(process, timeout=5)
        self.assertEqual(stdout.strip(), b"done")
        self.assertEqual(stderr, b"")
        self.assertEqual(process.returncode, 0)

    async def test_timeout_reaps_child_process(self) -> None:
        process = await self._sleeping_process()
        with self.assertRaises(asyncio.TimeoutError):
            await communicate_with_timeout(process, timeout=0.1)
        self.assertIsNotNone(process.returncode)

    async def test_user_cancel_reaps_child_process(self) -> None:
        process = await self._sleeping_process()
        cancel_event = asyncio.Event()
        cancel_event.set()
        with self.assertRaises(RenderCancelled):
            await communicate_with_timeout(process, timeout=5, cancel_event=cancel_event)
        self.assertIsNotNone(process.returncode)

    async def test_worker_shutdown_also_stops_descendant(self) -> None:
        process = await asyncio.create_subprocess_exec(
            sys.executable, "-u", "-c",
            "import subprocess,sys,time; child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)']); print(child.pid,flush=True); time.sleep(60)",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        assert process.stdout
        child_pid = int(await asyncio.wait_for(process.stdout.readline(), timeout=5))
        communication = asyncio.create_task(communicate_with_timeout(process, timeout=30))
        await asyncio.sleep(0.05)
        communication.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await communication
        self.assertIsNotNone(process.returncode)
        if psutil.pid_exists(child_pid):
            self.assertEqual(psutil.Process(child_pid).status(), psutil.STATUS_ZOMBIE)

    async def _sleeping_process(self) -> asyncio.subprocess.Process:
        return await asyncio.create_subprocess_exec(
            sys.executable, "-c", "import time; time.sleep(60)",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
