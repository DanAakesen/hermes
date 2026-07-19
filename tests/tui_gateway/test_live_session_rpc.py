from __future__ import annotations

import importlib
import threading
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture()
def server():
    with patch.dict(
        "sys.modules",
        {
            "hermes_cli.env_loader": MagicMock(),
            "hermes_cli.banner": MagicMock(),
        },
    ):
        mod = importlib.import_module("tui_gateway.server")
        yield mod
        mod._sessions.clear()
        mod._pending.clear()
        mod._answers.clear()


class FakeAgent:
    def __init__(self):
        self._cached_system_prompt = ""
        self.tools = [
            {
                "type": "function",
                "function": {
                    "name": "lookup",
                    "description": "Look something up",
                    "parameters": {
                        "type": "object",
                        "properties": {"query": {"type": "string"}},
                        "required": ["query"],
                    },
                },
            }
        ]

    def _build_system_prompt(self, _override):
        return "stable Hermes prompt"

    def _execute_tool_calls(self, assistant, messages, _session_key):
        call = assistant.tool_calls[0]
        assert call.function.name == "lookup"
        messages.append({"role": "tool", "tool_call_id": call.id, "content": "found it"})


@pytest.fixture()
def live_session(server):
    sid = "live-ui-id"
    session = {
        "session_key": "durable-session-id",
        "agent": FakeAgent(),
        "history": [],
        "history_lock": threading.Lock(),
        "history_version": 0,
        "running": False,
        "cwd": "",
    }
    server._sessions[sid] = session
    return sid, session


def call(server, method: str, **params):
    return server._methods[method]("request-1", params)


def test_live_session_describe_exposes_stable_prompt_and_realtime_tools(server, live_session):
    sid, _ = live_session

    response = call(server, "live.session.describe", session_id=sid)

    assert response["result"]["instructions"] == "stable Hermes prompt"
    assert response["result"]["session_key"] == "durable-session-id"
    assert response["result"]["tools"] == [
        {
            "type": "function",
            "name": "lookup",
            "description": "Look something up",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        }
    ]


def test_live_tool_execute_uses_agent_executor_without_polluting_text_history(server, live_session):
    sid, session = live_session

    response = call(
        server,
        "live.tool.execute",
        session_id=sid,
        call_id="call-1",
        name="lookup",
        arguments={"query": "voice"},
    )

    assert response["result"] == {"call_id": "call-1", "name": "lookup", "output": "found it"}
    assert session["history"] == []
    assert session["history_version"] == 0


def test_live_tool_execute_rejects_tools_not_available_in_session(server, live_session):
    sid, session = live_session

    response = call(
        server,
        "live.tool.execute",
        session_id=sid,
        name="not_allowed",
        arguments={},
    )

    assert response["error"]["code"] == 4003
    assert session["history"] == []


def test_live_transcript_persists_and_preserves_role_alternation(server, live_session, monkeypatch):
    sid, session = live_session
    db = SimpleNamespace(append_message=MagicMock(), replace_messages=MagicMock())
    monkeypatch.setattr(server, "_ensure_session_db_row", lambda _session: None)
    monkeypatch.setattr(server, "_session_db", lambda _session: nullcontext(db))

    first = call(server, "live.transcript.append", session_id=sid, role="user", text=" hello ")
    continuation = call(server, "live.transcript.append", session_id=sid, role="user", text="there")
    duplicate = call(server, "live.transcript.append", session_id=sid, role="user", text="hello there")
    second = call(server, "live.transcript.append", session_id=sid, role="assistant", text="hi")

    assert first["result"]["appended"] is True
    assert continuation["result"] == {"appended": True, "merged": True}
    assert duplicate["result"]["appended"] is False
    assert second["result"]["appended"] is True
    assert session["history"] == [
        {"role": "user", "content": "hello there"},
        {"role": "assistant", "content": "hi"},
    ]
    assert db.append_message.call_count == 2
    db.replace_messages.assert_called_once()
