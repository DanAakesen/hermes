from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from gpt_realtime_voice.config import VoiceRuntimeConfig
from gpt_realtime_voice.server import create_app


class FakeAdapter:
    def public_config(self) -> dict[str, Any]:
        return {"provider": "fake", "model": "voice-test", "voice": "test"}

    async def create_browser_session(self, api_key: str, safety_identifier: str) -> dict[str, Any]:
        assert safety_identifier
        return {"value": "ek_test", "expires_at": 123, **self.public_config(), "calls_url": "https://example.test"}


def test_health_and_static_client(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    config = VoiceRuntimeConfig(enforce_loopback_peer=False)
    with TestClient(create_app(config, FakeAdapter()), base_url="http://127.0.0.1:8765") as client:
        health = client.get("/health")
        page = client.get("/")

    assert health.status_code == 200
    assert health.json()["scope"] == "loopback"
    assert page.status_code == 200
    assert "Realtime voice" in page.text
    assert page.headers["x-frame-options"] == "DENY"


def test_client_secret_requires_same_origin(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    config = VoiceRuntimeConfig(enforce_loopback_peer=False)
    with TestClient(create_app(config, FakeAdapter()), base_url="http://127.0.0.1:8765") as client:
        denied = client.post("/api/realtime/client-secret", headers={"Origin": "https://attacker.example"})
        wrong_port = client.post(
            "/api/realtime/client-secret",
            headers={"Origin": "http://127.0.0.1:9999"},
        )
        allowed = client.post("/api/realtime/client-secret", headers={"Origin": "http://127.0.0.1:8765"})

    assert denied.status_code == 403
    assert wrong_port.status_code == 403
    assert allowed.status_code == 200
    assert allowed.json()["value"] == "ek_test"
    assert allowed.headers["cache-control"] == "no-store"
