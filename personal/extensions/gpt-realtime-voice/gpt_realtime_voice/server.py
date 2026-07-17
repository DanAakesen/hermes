"""Loopback FastAPI host for the Realtime browser and Hermes gateway."""

from __future__ import annotations

import hashlib
import os
import secrets
import threading
import time
import webbrowser
from collections import defaultdict, deque
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request, WebSocket
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import VoiceRuntimeConfig, is_loopback_host
from .openai_adapter import OpenAIRealtimeAdapter, RealtimeUpstreamError, RealtimeVoiceAdapter


_STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


class _RateLimiter:
    def __init__(self, limit: int = 10, window_seconds: int = 60) -> None:
        self.limit = limit
        self.window_seconds = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key]
            while hits and now - hits[0] > self.window_seconds:
                hits.popleft()
            if len(hits) >= self.limit:
                return False
            hits.append(now)
            return True


def _peer_is_loopback(host: str | None) -> bool:
    return bool(host) and is_loopback_host(host)


def _hostname(value: str) -> str:
    if not value:
        return ""
    parsed = urlsplit(value if "://" in value else f"//{value}")
    return (parsed.hostname or "").lower()


def _origin_allowed(origin: str | None, config: VoiceRuntimeConfig) -> bool:
    if not origin:
        return False
    parsed = urlsplit(origin)
    if parsed.scheme != "http":
        return False
    try:
        port = parsed.port or 80
    except ValueError:
        return False
    return (
        (parsed.hostname or "").lower() in config.allowed_hostnames
        and port == config.port
    )


def _safety_identifier() -> str:
    """Create a stable, privacy-preserving identifier in runtime state."""

    try:
        from hermes_constants import get_hermes_home

        state_dir = Path(get_hermes_home()) / "gpt-realtime-voice"
    except Exception:
        state_dir = Path.cwd() / ".local" / "home" / "gpt-realtime-voice"
    state_dir.mkdir(parents=True, exist_ok=True)
    identifier_file = state_dir / "installation-id"
    if identifier_file.exists():
        raw = identifier_file.read_text(encoding="utf-8").strip()
    else:
        raw = secrets.token_urlsafe(32)
        identifier_file.write_text(raw, encoding="utf-8")
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def create_app(
    config: VoiceRuntimeConfig,
    adapter: RealtimeVoiceAdapter | None = None,
) -> FastAPI:
    config.validate()
    active_adapter = adapter or OpenAIRealtimeAdapter(config)
    limiter = _RateLimiter()
    safety_id = _safety_identifier()

    app = FastAPI(title="Hermes Realtime Voice", docs_url=None, redoc_url=None)
    app.state.voice_config = config
    app.mount("/assets", StaticFiles(directory=_STATIC_DIR), name="assets")

    @app.middleware("http")
    async def security_boundary(request: Request, call_next):
        peer = request.client.host if request.client else None
        if config.enforce_loopback_peer and not _peer_is_loopback(peer):
            return JSONResponse({"detail": "loopback clients only"}, status_code=403)

        host = _hostname(request.headers.get("host", ""))
        if host not in config.allowed_hostnames:
            return JSONResponse({"detail": "invalid host"}, status_code=400)

        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
            "media-src 'self' blob:; connect-src 'self' https://api.openai.com wss://api.openai.com; "
            "frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
        )
        return response

    @app.get("/")
    async def index() -> FileResponse:
        return FileResponse(_STATIC_DIR / "index.html")

    @app.get("/health")
    async def health() -> dict[str, object]:
        return {
            "status": "ok",
            "scope": "loopback",
            "openai_key_configured": bool(os.environ.get("OPENAI_API_KEY", "").strip()),
            **active_adapter.public_config(),
        }

    @app.post("/api/realtime/client-secret")
    async def realtime_client_secret(request: Request) -> JSONResponse:
        if not _origin_allowed(request.headers.get("origin"), config):
            raise HTTPException(status_code=403, detail="same-origin browser request required")
        peer = request.client.host if request.client else "unknown"
        if not limiter.allow(peer):
            raise HTTPException(status_code=429, detail="too many Realtime session requests")
        try:
            payload = await active_adapter.create_browser_session(
                os.environ.get("OPENAI_API_KEY", ""),
                safety_id,
            )
        except RealtimeUpstreamError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        return JSONResponse(payload, headers={"Cache-Control": "no-store"})

    @app.websocket("/api/hermes")
    async def hermes_gateway(ws: WebSocket) -> None:
        peer = ws.client.host if ws.client else None
        if config.enforce_loopback_peer and not _peer_is_loopback(peer):
            await ws.close(code=4403)
            return
        if not _origin_allowed(ws.headers.get("origin"), config):
            await ws.close(code=4403)
            return
        from tui_gateway.ws import handle_ws

        await handle_ws(ws)

    return app


def run_server(config: VoiceRuntimeConfig, *, open_browser: bool = False) -> None:
    config.validate()
    if not os.environ.get("OPENAI_API_KEY", "").strip():
        raise RuntimeError("OPENAI_API_KEY is missing from the active Hermes environment")

    import uvicorn

    if open_browser:
        timer = threading.Timer(1.0, lambda: webbrowser.open(config.browser_url))
        timer.daemon = True
        timer.start()

    print(f"Hermes Realtime Voice: {config.browser_url}")
    print("Local-only milestone: remote binds are intentionally refused.")
    uvicorn.run(create_app(config), host=config.host, port=config.port, log_level="info")
