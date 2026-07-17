# GPT Realtime Voice for personal Hermes

This plugin adds a local, mobile-shaped realtime voice client without changing
Hermes core. OpenAI Realtime handles audio transport and speech rendering;
Hermes remains the agent, including its configured Copilot provider, tools,
session state, and approval boundaries.

## Run locally

From the repository root:

```powershell
.\personal\extensions\gpt-realtime-voice\install-dev.ps1
.\scripts\hermes-personal.ps1 voice serve --open
```

The client listens on `http://127.0.0.1:8765`. The first milestone refuses
non-loopback binds. `OPENAI_API_KEY` must exist only in
`.local\home\.env`.

## What the prototype proves

- Browser microphone and speaker audio use an OpenAI Realtime WebRTC session.
- Automatic Realtime assistant responses are disabled.
- Completed speech is submitted to a persistent Hermes JSON-RPC session.
- Hermes responses are rendered as streamed audio by an out-of-band Realtime
  response.
- Tool approvals remain explicit visual actions; voice never auto-approves.

The browser client is suitable for local desktop testing. Phone access is a
later HTTPS/authentication milestone because mobile browsers require a secure
context for microphone access and the local server must not be exposed without
an access gate.
