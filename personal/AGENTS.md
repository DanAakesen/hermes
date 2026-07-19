# Personal extensions

This subtree contains Dana's versioned Hermes customizations. It is not an
upstream contribution surface.

- Keep personal extension code under `personal/` and runtime state under
  `.local/home/`.
- Never commit credentials, session tokens, transcripts, or generated runtime
  state.
- Prefer Hermes plugin APIs and existing gateway transports over edits to core.
- Voice clients must treat Hermes as the harness. Realtime providers may run
  live voice inference and select functions, but Hermes alone executes tools,
  applies approvals, and owns durable state.
- Default network services to loopback. Remote access requires authenticated
  TLS termination and a separate security review.
- Never auto-approve Hermes tool actions from voice input.
- Keep provider-specific Realtime request and event shapes behind an adapter.
- Validate plugin discovery, the real Hermes JSON-RPC path, and provider session
  creation in addition to unit tests.
