"""Authenticated Desktop bootstrap for short-lived OpenAI Realtime sessions."""

from __future__ import annotations

import hashlib
import logging
import os
import secrets
import sys
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

_PLUGIN_ROOT = Path(__file__).resolve().parent.parent
if str(_PLUGIN_ROOT) not in sys.path:
    sys.path.insert(0, str(_PLUGIN_ROOT))

from gpt_realtime_voice.config import VoiceRuntimeConfig
from gpt_realtime_voice.openai_adapter import OpenAIRealtimeAdapter, RealtimeUpstreamError
from hermes_cli.env_loader import load_hermes_dotenv
from hermes_constants import get_hermes_home


router = APIRouter()
logger = logging.getLogger(__name__)
load_hermes_dotenv(hermes_home=get_hermes_home())
_adapter = OpenAIRealtimeAdapter(VoiceRuntimeConfig())


class SessionRequest(BaseModel):
    instructions: str = Field(min_length=1, max_length=500_000)
    tools: list[dict[str, Any]] = Field(default_factory=list, max_length=500)


class LifecycleEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event: Literal[
        "session.ready",
        "tool.complete",
        "response.create",
        "response.created",
        "response.done",
        "response.cancelled",
        "audio.started",
        "audio.stopped",
        "speech.started",
        "speech.stopped",
        "playback.ready",
        "playback.error",
    ]
    tool: str | None = Field(default=None, max_length=128)
    outcome: Literal["ok", "error"] | None = None


def _safety_identifier() -> str:
    from hermes_constants import get_hermes_home

    state_dir = Path(get_hermes_home()) / "gpt-realtime-voice"
    state_dir.mkdir(parents=True, exist_ok=True)
    identifier_file = state_dir / "installation-id"
    if identifier_file.exists():
        raw = identifier_file.read_text(encoding="utf-8").strip()
    else:
        raw = secrets.token_urlsafe(32)
        identifier_file.write_text(raw, encoding="utf-8")
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


@router.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "openai_key_configured": bool(os.environ.get("OPENAI_API_KEY", "").strip()),
        **_adapter.public_config(),
    }


@router.post("/session")
async def create_session(body: SessionRequest) -> dict[str, Any]:
    try:
        return await _adapter.create_session(
            os.environ.get("OPENAI_API_KEY", ""),
            _safety_identifier(),
            body.instructions,
            body.tools,
        )
    except RealtimeUpstreamError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/event")
def record_lifecycle_event(body: LifecycleEvent) -> dict[str, bool]:
    """Record metadata-only lifecycle proof without speech or tool payloads."""

    logger.info(
        "Realtime voice lifecycle event=%s tool=%s outcome=%s",
        body.event,
        body.tool or "not provided",
        body.outcome or "not provided",
    )
    return {"recorded": True}
