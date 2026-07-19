"""Provider configuration for Hermes Desktop live voice."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class VoiceRuntimeConfig:
    """OpenAI-specific settings behind the replaceable provider adapter."""

    realtime_model: str = "gpt-realtime-2.1"
    transcription_model: str = "gpt-4o-mini-transcribe"
    voice: str = "marin"
    client_secret_ttl_seconds: int = 600

    def validate(self) -> None:
        if not self.realtime_model.strip():
            raise ValueError("realtime model is required")
        if not self.transcription_model.strip():
            raise ValueError("transcription model is required")
        if not self.voice.strip():
            raise ValueError("voice is required")
        if not 60 <= self.client_secret_ttl_seconds <= 600:
            raise ValueError("client secret TTL must be between 60 and 600 seconds")
