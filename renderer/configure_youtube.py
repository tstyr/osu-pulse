from __future__ import annotations

import argparse
import base64
import hashlib
import json
import secrets
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit

import httpx
from dotenv import set_key


AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
SCOPE = " ".join((
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.force-ssl",
))
RENDERER_ENV = Path(__file__).resolve().parent / ".env"


def _client(path: Path) -> tuple[str, str | None]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise SystemExit(f"Could not read OAuth client JSON: {exc}") from exc
    installed = payload.get("installed") if isinstance(payload, dict) else None
    if not isinstance(installed, dict):
        raise SystemExit("Use a Google OAuth client created as Desktop app.")
    client_id = installed.get("client_id")
    client_secret = installed.get("client_secret")
    if not isinstance(client_id, str) or not client_id:
        raise SystemExit("OAuth client JSON has no client_id.")
    return client_id, client_secret if isinstance(client_secret, str) and client_secret else None


class CallbackHandler(BaseHTTPRequestHandler):
    result: dict[str, str] = {}

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        parsed = urlsplit(self.path)
        if parsed.path != "/oauth2callback":
            self.send_error(404)
            return
        values = parse_qs(parsed.query)
        type(self).result = {key: items[0] for key, items in values.items() if items}
        ok = "code" in type(self).result
        body = ("YouTube authorization completed. You can close this tab." if ok else "YouTube authorization failed.").encode()
        self.send_response(200 if ok else 400)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format: str, *_args: object) -> None:
        return


def main() -> int:
    parser = argparse.ArgumentParser(description="Authorize osu! Pulse to upload YouTube videos")
    parser.add_argument("client_json", type=Path, help="OAuth Desktop app client JSON downloaded from Google Cloud")
    parser.add_argument("--privacy", choices=("private", "unlisted", "public"), default="public")
    args = parser.parse_args()
    client_id, client_secret = _client(args.client_json.resolve())

    server = HTTPServer(("127.0.0.1", 0), CallbackHandler)
    server.timeout = 1
    redirect_uri = f"http://127.0.0.1:{server.server_port}/oauth2callback"
    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    authorization_url = AUTH_URL + "?" + urlencode({
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": SCOPE,
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    })
    print("Opening Google authorization in your browser...")
    if not webbrowser.open(authorization_url):
        print(authorization_url)

    deadline = time.monotonic() + 300
    CallbackHandler.result = {}
    while time.monotonic() < deadline and not CallbackHandler.result:
        server.handle_request()
    server.server_close()
    result = CallbackHandler.result
    if not result:
        raise SystemExit("Authorization timed out.")
    if result.get("state") != state:
        raise SystemExit("OAuth state mismatch.")
    if result.get("error"):
        raise SystemExit(f"Google denied authorization: {result['error']}")
    code = result.get("code")
    if not code:
        raise SystemExit("Google returned no authorization code.")

    form = {
        "client_id": client_id,
        "code": code,
        "code_verifier": verifier,
        "grant_type": "authorization_code",
        "redirect_uri": redirect_uri,
    }
    if client_secret:
        form["client_secret"] = client_secret
    response = httpx.post(TOKEN_URL, data=form, timeout=30)
    if response.status_code != 200:
        raise SystemExit(f"OAuth token exchange failed with HTTP {response.status_code}.")
    payload = response.json()
    refresh_token = payload.get("refresh_token") if isinstance(payload, dict) else None
    if not isinstance(refresh_token, str) or not refresh_token:
        raise SystemExit("Google returned no refresh token. Revoke the app grant and run setup again.")

    RENDERER_ENV.touch(exist_ok=True)
    set_key(RENDERER_ENV, "YOUTUBE_AUTO_UPLOAD", "true")
    set_key(RENDERER_ENV, "YOUTUBE_CLIENT_ID", client_id)
    set_key(RENDERER_ENV, "YOUTUBE_CLIENT_SECRET", client_secret or "")
    set_key(RENDERER_ENV, "YOUTUBE_REFRESH_TOKEN", refresh_token)
    set_key(RENDERER_ENV, "YOUTUBE_PRIVACY_STATUS", args.privacy)
    print(f"[OK] YouTube auto-upload is configured for {args.privacy} videos.")
    print("Restart renderer/start_renderer.bat to apply it.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
