# GPT Realtime Voice for personal Hermes

This extension replaces Hermes Desktop's primary voice-conversation loop with
a native OpenAI Realtime WebRTC session. OpenAI hears and speaks directly;
Hermes supplies the stable session instructions and tool schemas, validates
every function call, executes it through the normal Hermes runtime, and keeps
approval and durable-state authority.

## Install the development links

From the repository root:

```powershell
.\personal\extensions\gpt-realtime-voice\install-dev.ps1
```

This links the Python backend plugin into `.local/home/plugins/` and the
Desktop runtime plugin into `.local/home/desktop-plugins/`. The standard
`OPENAI_API_KEY` stays only in `.local/home/.env`; the renderer receives a
short-lived Realtime client secret.

Restart **Hermes (Personal)**, open an existing chat, and press the large
AudioLines voice button. Dictation and read-aloud remain separate legacy
controls; the primary conversation button uses Realtime when this plugin is
enabled.

## Current milestone

- Direct bidirectional audio over WebRTC; no transcript-gated STT → Hermes → TTS cascade.
- `gpt-realtime-2.1` with server VAD, interruption, and model-owned speech.
- The live model receives the current Hermes session prompt and function schemas.
- Function calls run through the existing Hermes tool executor, including tool
  progress, guardrails, approvals, memory, and delegation.
- Completed transcripts are mirrored into Hermes session history asynchronously.
- Local Desktop only. Mobile/remote access needs authenticated HTTPS and a
  separate client milestone.
