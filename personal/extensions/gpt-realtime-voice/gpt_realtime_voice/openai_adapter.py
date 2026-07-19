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

    async def create_session(
        self,
        api_key: str,
        safety_identifier: str,
        instructions: str,
        tools: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Return short-lived client connection data without exposing the server key."""

    def public_config(self) -> dict[str, Any]:
        """Return non-secret provider metadata used by the browser transport."""


@dataclass(slots=True)
class OpenAIRealtimeAdapter:
    config: VoiceRuntimeConfig
    http_client: httpx.AsyncClient | None = None

    def session_request(self, instructions: str, tools: list[dict[str, Any]]) -> dict[str, Any]:
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
                    f"{instructions}\n\n"
                    "You are Hermes in a live voice session. Respond naturally and concisely in speech. "
                    "Use the supplied Hermes tools whenever they are needed. Tool execution and approvals "
                    "are controlled by the Hermes harness; never claim a tool succeeded until its result "
                    "is returned. The supplied tool schemas are the authoritative list of tools available "
                    "in this session. If asked what tools you have, answer from those schemas; never run "
                    "Hermes setup, Hermes tools, or another interactive configuration command to enumerate "
                    "them. Do not start interactive terminal programs in a voice session. Do not mention "
                    "transcripts or the voice transport unless asked."
                ),
                "audio": {
                    "input": {
                        "transcription": {"model": self.config.transcription_model},
                        "turn_detection": {
                            "type": "server_vad",
                            "create_response": True,
                            "interrupt_response": True,
                            "prefix_padding_ms": 300,
                            "silence_duration_ms": 500,
                        },
                    },
                    "output": {
                        "voice": self.config.voice,
                    },
                },
                "tool_choice": "auto",
                "tools": tools,
            },
        }

    def public_config(self) -> dict[str, Any]:
        return {
            "provider": "openai",
            "model": self.config.realtime_model,
            "voice": self.config.voice,
            "calls_url": "https://api.openai.com/v1/realtime/calls",
        }

    async def create_session(
        self,
        api_key: str,
        safety_identifier: str,
        instructions: str,
        tools: list[dict[str, Any]],
    ) -> dict[str, Any]:
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
                json=self.session_request(instructions, tools),
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
