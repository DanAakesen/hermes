from __future__ import annotations

import httpx
import pytest

from gpt_realtime_voice.config import VoiceRuntimeConfig
from gpt_realtime_voice.openai_adapter import OpenAIRealtimeAdapter, RealtimeUpstreamError


def test_session_is_native_voice_with_hermes_tools() -> None:
    tools = [{"type": "function", "name": "terminal", "parameters": {"type": "object"}}]
    request = OpenAIRealtimeAdapter(VoiceRuntimeConfig()).session_request("Hermes system", tools)
    session = request["session"]
    turn_detection = session["audio"]["input"]["turn_detection"]

    assert session["model"] == "gpt-realtime-2.1"
    assert session["tool_choice"] == "auto"
    assert session["tools"] == tools
    assert "Hermes system" in session["instructions"]
    assert turn_detection["create_response"] is True
    assert turn_detection["interrupt_response"] is True
    assert session["audio"]["input"]["transcription"]["model"] == "gpt-4o-mini-transcribe"


@pytest.mark.asyncio
async def test_browser_payload_contains_only_short_lived_session_data() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer test-secret"
        assert request.headers["openai-safety-identifier"] == "safe-id"
        return httpx.Response(200, json={"value": "ek_test", "expires_at": 12345})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        adapter = OpenAIRealtimeAdapter(VoiceRuntimeConfig(), http_client=client)
        payload = await adapter.create_session("test-secret", "safe-id", "Hermes", [])

    assert payload["value"] == "ek_test"
    assert payload["model"] == "gpt-realtime-2.1"
    assert "test-secret" not in repr(payload)


@pytest.mark.asyncio
async def test_upstream_errors_do_not_echo_response_body() -> None:
    async def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(401, text="sensitive upstream detail")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        adapter = OpenAIRealtimeAdapter(VoiceRuntimeConfig(), http_client=client)
        with pytest.raises(RealtimeUpstreamError) as exc_info:
            await adapter.create_session("bad-key", "safe-id", "Hermes", [])

    assert "sensitive upstream detail" not in str(exc_info.value)
    assert "HTTP 401" in str(exc_info.value)
