from __future__ import annotations

import os
import secrets
import shutil
import subprocess
from pathlib import Path

from dotenv import dotenv_values, set_key


PROJECT_ROOT = Path(__file__).resolve().parent.parent
ROOT_ENV = PROJECT_ROOT / ".env.local"
RENDERER_ENV = PROJECT_ROOT / "renderer" / ".env"
ACCESS_KEY_FILE = PROJECT_ROOT / "outputs" / "render-access-key.txt"


def generated(existing: str | None, prefix: str) -> str:
    return existing or f"{prefix}_{secrets.token_urlsafe(36)}"


def vercel_env(name: str, value: str) -> None:
    npx = shutil.which("npx")
    if not npx:
        raise RuntimeError("npx was not found")
    # Preview remains closed unless a branch-specific key is configured manually.
    for target in ("production", "development"):
        result = subprocess.run(
            [npx, "vercel", "env", "add", name, target, "--force", "--yes", "--no-color"],
            cwd=PROJECT_ROOT,
            input=value + "\n",
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(f"Could not configure {name} for {target}")


def main() -> None:
    root_values = dotenv_values(ROOT_ENV)
    blob_token = root_values.get("BLOB_READ_WRITE_TOKEN")
    if not blob_token:
        raise RuntimeError("BLOB_READ_WRITE_TOKEN is missing; create and connect a Vercel Blob store first")

    web_key = generated(root_values.get("WEB_RENDER_ACCESS_KEY"), "opr")
    bridge_token = generated(root_values.get("RENDER_BRIDGE_TOKEN"), "orb")
    vercel_env("WEB_RENDER_ACCESS_KEY", web_key)
    vercel_env("RENDER_BRIDGE_TOKEN", bridge_token)

    set_key(ROOT_ENV, "WEB_RENDER_ACCESS_KEY", web_key)
    set_key(ROOT_ENV, "RENDER_BRIDGE_TOKEN", bridge_token)

    RENDERER_ENV.touch(exist_ok=True)
    set_key(RENDERER_ENV, "RENDER_CLOUD_URL", "https://osu-pulse.vercel.app")
    set_key(RENDERER_ENV, "RENDER_BRIDGE_TOKEN", bridge_token)
    set_key(RENDERER_ENV, "BLOB_READ_WRITE_TOKEN", blob_token)

    ACCESS_KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
    ACCESS_KEY_FILE.write_text(web_key + "\n", encoding="utf-8")
    os.chmod(ACCESS_KEY_FILE, 0o600)
    print("Cloud bridge secrets configured for Vercel and the local renderer.")
    print(f"Web access key saved to: {ACCESS_KEY_FILE}")


if __name__ == "__main__":
    main()
