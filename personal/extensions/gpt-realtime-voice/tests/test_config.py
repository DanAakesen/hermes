from __future__ import annotations

from gpt_realtime_voice.config import VoiceRuntimeConfig


def test_default_configuration_uses_current_realtime_provider() -> None:
    config = VoiceRuntimeConfig()
    config.validate()
    assert config.realtime_model == "gpt-realtime-2.1"
