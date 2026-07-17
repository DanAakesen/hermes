"""Provider boundary for OpenAI's current GA Realtime API."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

import httpx

from .config import VoiceRuntimeConfig


CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets"


class RealtimeUpstreamError(RuntimeError):
    """Safe provider error that never includes credentials or response bodies."""


class RealtimeVoiceAdapter(Protocol):
    """Boundary for future Realtime providers such as GPT Live 1."""

    async def create_browser_session(self, api_key: str, safety_identifier: str) -> dict[str, Any]:
        """Return short-lived browser connection data without exposing the server key."""

    def public_config(self) -> dict[str, Any]:
        """Return non-secret provider metadata used by the browser transport."""


@dataclass(slots=True)
class OpenAIRealtimeAdapter:
    config: VoiceRuntimeConfig
    http_client: httpx.AsyncClient | None = None

    def session_request(self) -> dict[str, Any]:
        """Build the current GA session shape in one replaceable adapter."""

        return {
            "expires_after": {
                "anchor": "created_at",
                "seconds": self.config.client_secret_ttl_seconds,
            },
            "session": {
                "type": "realtime",
                "model": self.config.realtime_model,
                "output_modalities": ["audio"],
                "instructions": (
                    "You are the realtime speech transport for Hermes. Hermes is the agent. "
                    "Never answer microphone input automatically. When asked to render a Hermes "
                    "response, speak only that supplied response and add no facts or advice."
                ),
                "audio": {
                    "input": {
                        "transcription": {"model": self.config.transcription_model},
                        "turn_detection": {
                            "type": "server_vad",
                            "create_response": False,
                            "interrupt_response": True,
                            "prefix_padding_ms": 300,
                            "silence_duration_ms": 500,
                        },
                    },
                    "output": {
                        "voice": self.config.voice,
                    },
                },
                "tool_choice": "none",
                "tools": [],
            },
        }

    def public_config(self) -> dict[str, Any]:
        return {
            "provider": "openai",
            "model": self.config.realtime_model,
            "voice": self.config.voice,
            "calls_url": "https://api.openai.com/v1/realtime/calls",
        }

    async def create_browser_session(self, api_key: str, safety_identifier: str) -> dict[str, Any]:
        if not api_key.strip():
            raise RealtimeUpstreamError("OPENAI_API_KEY is not configured")

        owns_client = self.http_client is None
        client = self.http_client or httpx.AsyncClient(timeout=httpx.Timeout(20.0))
        try:
            response = await client.post(
                CLIENT_SECRETS_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                    "OpenAI-Safety-Identifier": safety_identifier,
                },
                json=self.session_request(),
            )
            if response.status_code >= 400:
                request_id = response.headers.get("x-request-id", "not provided")
                raise RealtimeUpstreamError(
                    f"OpenAI Realtime session creation failed (HTTP {response.status_code}, request {request_id})"
                )
            try:
                payload = response.json()
            except ValueError as exc:
                raise RealtimeUpstreamError("OpenAI returned an invalid Realtime session response") from exc

            value = payload.get("value")
            if not isinstance(value, str) or not value:
                raise RealtimeUpstreamError("OpenAI did not return a Realtime client secret")

            return {
                "value": value,
                "expires_at": payload.get("expires_at"),
                **self.public_config(),
            }
        except httpx.RequestError as exc:
            raise RealtimeUpstreamError("Could not reach the OpenAI Realtime API") from exc
        finally:
            if owns_client:
                await client.aclose()
