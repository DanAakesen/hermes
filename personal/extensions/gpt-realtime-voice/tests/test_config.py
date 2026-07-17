from __future__ import annotations

import pytest

from gpt_realtime_voice.config import VoiceRuntimeConfig, is_loopback_host


@pytest.mark.parametrize("host", ["localhost", "127.0.0.1", "::1", "127.7.8.9"])
def test_loopback_hosts_are_allowed(host: str) -> None:
    assert is_loopback_host(host)


@pytest.mark.parametrize("host", ["0.0.0.0", "192.168.1.10", "voice.example.com"])
def test_remote_hosts_are_rejected(host: str) -> None:
    with pytest.raises(ValueError, match="loopback-only"):
        VoiceRuntimeConfig(host=host).validate()


def test_default_configuration_is_current_local_milestone() -> None:
    config = VoiceRuntimeConfig()
    config.validate()
    assert config.realtime_model == "gpt-realtime-2.1"
    assert config.browser_url == "http://127.0.0.1:8765/"
