"""Real OpenAI Realtime tool-continuation smoke test.

Run manually from the repository root. The script prints only event metadata;
it never prints credentials, tool arguments, tool results, or transcripts.
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any

import websockets

from hermes_cli.env_loader import load_hermes_dotenv
from hermes_constants import get_hermes_home


MODEL = "gpt-realtime-2.1"
URL = f"wss://api.openai.com/v1/realtime?model={MODEL}"


async def _receive_json(socket, timeout: float = 30.0) -> dict[str, Any]:
    return json.loads(await asyncio.wait_for(socket.recv(), timeout=timeout))


async def main() -> None:
    load_hermes_dotenv(hermes_home=get_hermes_home())
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured")

    async with websockets.connect(
        URL,
        additional_headers={"Authorization": f"Bearer {api_key}"},
        max_size=8 * 1024 * 1024,
    ) as socket:
        await socket.send(
            json.dumps(
                {
                    "type": "session.update",
                    "session": {
                        "type": "realtime",
                        "model": MODEL,
                        "output_modalities": ["audio"],
                        "instructions": (
                            "You are Hermes. Use the supplied tool when requested, then answer "
                            "the user's original request aloud from its result."
                        ),
                        "audio": {"output": {"voice": "marin"}},
                        "tools": [
                            {
                                "type": "function",
                                "name": "session_search",
                                "description": "Search past Hermes sessions.",
                                "parameters": {
                                    "type": "object",
                                    "properties": {"query": {"type": "string"}},
                                    "required": ["query"],
                                },
                            }
                        ],
                        "tool_choice": "auto",
                    },
                }
            )
        )

        while True:
            event = await _receive_json(socket)
            if event.get("type") == "error":
                raise RuntimeError(f"Realtime session error: {event.get('error', {}).get('message', 'unknown')}")
            if event.get("type") == "session.updated":
                break

        await socket.send(
            json.dumps(
                {
                    "type": "conversation.item.create",
                    "item": {
                        "type": "message",
                        "role": "user",
                        "content": [
                            {
                                "type": "input_text",
                                "text": "Search my sessions for Ed Sheeran and tell me what you find.",
                            }
                        ],
                    },
                }
            )
        )
        await socket.send(json.dumps({"type": "response.create"}))

        function_call: dict[str, Any] | None = None
        while function_call is None:
            event = await _receive_json(socket)
            if event.get("type") == "error":
                raise RuntimeError(f"Realtime tool-call error: {event.get('error', {}).get('message', 'unknown')}")
            if event.get("type") != "response.done":
                continue
            function_call = next(
                (item for item in event.get("response", {}).get("output", []) if item.get("type") == "function_call"),
                None,
            )
            if function_call is None:
                raise RuntimeError("Realtime model completed without calling session_search")

        tool_output = {
            "status": "success",
            "tool": "session_search",
            "result": {
                "matches": [
                    {
                        "title": "Play Ed Sheeran Banger",
                        "summary": "Played Shivers by Ed Sheeran.",
                    }
                ]
            },
            "response_instruction": "Answer the user's pending request aloud using this result.",
        }
        await socket.send(
            json.dumps(
                {
                    "type": "conversation.item.create",
                    "item": {
                        "type": "function_call_output",
                        "call_id": function_call["call_id"],
                        "output": json.dumps(tool_output),
                    },
                }
            )
        )
        await socket.send(
            json.dumps(
                {
                    "type": "response.create",
                    "response": {
                        "output_modalities": ["audio"],
                        "instructions": (
                            "Continue the current Hermes turn. The immediately preceding "
                            "function_call_output contains the completed Hermes tool result. "
                            "Answer the user's original request aloud now using that result. "
                            "Do not stay silent or merely acknowledge the tool call."
                        ),
                    },
                }
            )
        )

        transcript_seen = False
        audio_chunks = 0
        output_items = 0
        status = "not provided"
        while True:
            event = await _receive_json(socket)
            event_type = event.get("type")
            if event_type == "error":
                raise RuntimeError(f"Realtime continuation error: {event.get('error', {}).get('message', 'unknown')}")
            if event_type == "response.output_audio_transcript.done":
                transcript_seen = bool(str(event.get("transcript") or "").strip())
            elif event_type == "response.output_audio.delta":
                audio_chunks += 1
            elif event_type == "response.done":
                response = event.get("response", {})
                status = str(response.get("status") or "not provided")
                output_items = len(response.get("output") or [])
                break

        if status != "completed" or not transcript_seen or audio_chunks == 0 or output_items == 0:
            raise RuntimeError(
                "Realtime continuation was incomplete "
                f"(status={status}, transcript={transcript_seen}, audio_chunks={audio_chunks}, output_items={output_items})"
            )

        print(
            "Realtime tool continuation passed "
            f"(status={status}, transcript={transcript_seen}, audio_chunks={audio_chunks}, output_items={output_items})"
        )


if __name__ == "__main__":
    asyncio.run(main())
