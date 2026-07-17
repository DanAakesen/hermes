"""Runtime configuration and local-only network policy."""

from __future__ import annotations

import ipaddress
from dataclasses import dataclass


_LOOPBACK_NAMES = frozenset({"localhost", "127.0.0.1", "::1"})


def is_loopback_host(host: str) -> bool:
    candidate = host.strip().lower().strip("[]")
    if candidate in _LOOPBACK_NAMES:
        return True
    try:
        return ipaddress.ip_address(candidate).is_loopback
    except ValueError:
        return False


@dataclass(frozen=True, slots=True)
class VoiceRuntimeConfig:
    """Configuration for the first, intentionally local-only milestone."""

    host: str = "127.0.0.1"
    port: int = 8765
    realtime_model: str = "gpt-realtime-2.1"
    transcription_model: str = "gpt-4o-mini-transcribe"
    voice: str = "marin"
    client_secret_ttl_seconds: int = 600
    enforce_loopback_peer: bool = True

    def validate(self) -> None:
        if not is_loopback_host(self.host):
            raise ValueError(
                "Milestone 1 is loopback-only. Remote/mobile access requires authenticated HTTPS."
            )
        if not 1 <= self.port <= 65535:
            raise ValueError("port must be between 1 and 65535")
        if not self.realtime_model.strip():
            raise ValueError("realtime model is required")
        if not self.transcription_model.strip():
            raise ValueError("transcription model is required")
        if not self.voice.strip():
            raise ValueError("voice is required")
        if not 60 <= self.client_secret_ttl_seconds <= 600:
            raise ValueError("client secret TTL must be between 60 and 600 seconds")

    @property
    def browser_url(self) -> str:
        host = f"[{self.host}]" if ":" in self.host and not self.host.startswith("[") else self.host
        return f"http://{host}:{self.port}/"

    @property
    def allowed_hostnames(self) -> frozenset[str]:
        return _LOOPBACK_NAMES | frozenset({self.host.strip().lower().strip("[]")})
