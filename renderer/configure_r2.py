from __future__ import annotations

import argparse
import re
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import set_key


PROJECT_ROOT = Path(__file__).resolve().parent.parent
ROOT_ENV = PROJECT_ROOT / ".env.local"
RENDERER_ENV = PROJECT_ROOT / "renderer" / ".env"
R2_HOST_PATTERN = re.compile(r"^[0-9a-f]{32}(?:\.[a-z]{2})?\.r2\.cloudflarestorage\.com$")
BUCKET_PATTERN = re.compile(r"^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$")


def parse_bucket_url(value: str) -> tuple[str, str]:
    parsed = urlsplit(value.strip())
    parts = [part for part in parsed.path.split("/") if part]
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or not R2_HOST_PATTERN.fullmatch(parsed.hostname)
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or len(parts) != 1
        or not BUCKET_PATTERN.fullmatch(parts[0])
    ):
        raise ValueError(
            "Use https://<ACCOUNT_ID>.r2.cloudflarestorage.com/<bucket-name>"
        )
    return f"https://{parsed.hostname}", parts[0]


def main() -> None:
    parser = argparse.ArgumentParser(description="Configure the non-secret Cloudflare R2 bucket location")
    parser.add_argument("bucket_url", help="R2 S3 endpoint including one bucket path")
    args = parser.parse_args()
    endpoint, bucket = parse_bucket_url(args.bucket_url)
    if not ROOT_ENV.is_file():
        raise RuntimeError(".env.local is missing")
    RENDERER_ENV.touch(exist_ok=True)
    for target in (ROOT_ENV, RENDERER_ENV):
        set_key(target, "R2_ENDPOINT", endpoint)
        set_key(target, "R2_BUCKET", bucket)
    print(f"R2 endpoint configured for bucket: {bucket}")
    print("Add R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY to .env.local and renderer/.env to enable R2 uploads.")
    print("Until then, oversized videos use the configured Vercel Blob fallback.")


if __name__ == "__main__":
    main()
