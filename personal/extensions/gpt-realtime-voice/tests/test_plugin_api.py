from __future__ import annotations

import importlib.util
import logging
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient


def _load_plugin_api():
    path = Path(__file__).resolve().parents[1] / "dashboard" / "plugin_api.py"
    spec = importlib.util.spec_from_file_location("gpt_realtime_voice_plugin_api", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _client(plugin_api) -> TestClient:
    app = FastAPI()
    app.include_router(plugin_api.router)
    return TestClient(app)


def test_lifecycle_event_logs_metadata_only(caplog) -> None:
    plugin_api = _load_plugin_api()
    client = _client(plugin_api)

    with caplog.at_level(logging.INFO, logger=plugin_api.__name__):
        response = client.post(
            "/event",
            json={"event": "tool.complete", "tool": "session_search", "outcome": "ok"},
        )

    assert response.json() == {"recorded": True}
    assert "event=tool.complete tool=session_search outcome=ok" in caplog.text


def test_lifecycle_event_rejects_payload_fields() -> None:
    plugin_api = _load_plugin_api()
    client = _client(plugin_api)

    response = client.post(
        "/event",
        json={"event": "response.created", "transcript": "private speech"},
    )

    assert response.status_code == 422
