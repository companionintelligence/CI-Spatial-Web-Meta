"""Who may use the CV server's API.

- Every /v1 route needs `Authorization: Bearer <token>`. The token is CV_API_TOKEN when it is
  set, and otherwise a random token kept in CV_DATA_DIR/api-token, created with mode 0600 on
  the first start. It is never written to the repository and never logged.
- Browsers get cross-origin access only for origins listed in CORS_ALLOW_ORIGINS. The default
  is none, and '*' is refused.
- /healthz answers without a token and reveals nothing; it exists for container healthchecks.

Pure apart from the token file, so it can be tested without a server.
"""

from __future__ import annotations

import hmac
import os
import secrets
from pathlib import Path
from typing import Mapping
from urllib.parse import urlsplit

TOKEN_FILE_NAME = "api-token"
MIN_TOKEN_LENGTH = 24
PROTECTED_PREFIX = "/v1"
PUBLIC_PATHS = frozenset({"/healthz"})


class TokenError(ValueError):
    """CV_API_TOKEN is set but too short to be a secret."""


def load_or_create_token(env: Mapping[str, str], data_dir: Path) -> str:
    """The API token: CV_API_TOKEN, else the token file, else a new one written with mode 0600."""
    supplied = (env.get("CV_API_TOKEN") or "").strip()
    if supplied:
        if len(supplied) < MIN_TOKEN_LENGTH:
            raise TokenError(f"CV_API_TOKEN must be at least {MIN_TOKEN_LENGTH} characters.")
        return supplied

    path = Path(data_dir) / TOKEN_FILE_NAME
    if path.is_file():
        stored = path.read_text(encoding="utf-8").strip()
        if len(stored) >= MIN_TOKEN_LENGTH:
            return stored

    path.parent.mkdir(parents=True, exist_ok=True)
    token = secrets.token_urlsafe(32)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(token + "\n")
    os.chmod(path, 0o600)
    return token


def cors_origins_from_env(env: Mapping[str, str]) -> list[str]:
    """The origins allowed to call the API from a browser. Empty means none."""
    raw = (env.get("CORS_ALLOW_ORIGINS") or "").strip()
    origins: list[str] = []
    for item in (part.strip() for part in raw.split(",")):
        if not item:
            continue
        if item == "*":
            raise ValueError("CORS_ALLOW_ORIGINS must list explicit origins; '*' is not allowed.")
        parts = urlsplit(item)
        if parts.scheme not in ("http", "https") or not parts.netloc:
            raise ValueError(f"CORS_ALLOW_ORIGINS entry {item!r} is not an origin (scheme://host[:port]).")
        if parts.path not in ("", "/") or parts.query or parts.fragment:
            raise ValueError(f"CORS_ALLOW_ORIGINS entry {item!r} must not have a path, query or fragment.")
        origins.append(f"{parts.scheme}://{parts.netloc}")
    return origins


def _bearer_matches(header: str, expected: str) -> bool:
    scheme, _, given = header.strip().partition(" ")
    if scheme.lower() != "bearer" or not given.strip():
        return False
    return hmac.compare_digest(given.strip().encode("utf-8"), expected.encode("utf-8"))


class RequireBearerToken:
    """ASGI middleware: every /v1 request must carry the token. Preflights and /healthz pass."""

    def __init__(self, app, token: str):
        if not token:
            raise TokenError("The CV server needs an API token before it can serve requests.")
        self.app = app
        self.token = token

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            return await self.app(scope, receive, send)
        path = scope.get("path", "")
        protected = path == PROTECTED_PREFIX or path.startswith(PROTECTED_PREFIX + "/")
        if not protected or path in PUBLIC_PATHS or scope.get("method") == "OPTIONS":
            return await self.app(scope, receive, send)

        headers = {
            key.decode("latin-1").lower(): value.decode("latin-1")
            for key, value in scope.get("headers", [])
        }
        if _bearer_matches(headers.get("authorization", ""), self.token):
            return await self.app(scope, receive, send)

        body = b'{"detail":"a valid bearer token is required"}'
        await send({
            "type": "http.response.start",
            "status": 401,
            "headers": [
                (b"content-type", b"application/json"),
                (b"www-authenticate", b"Bearer"),
                (b"content-length", str(len(body)).encode("ascii")),
            ],
        })
        await send({"type": "http.response.body", "body": body})
