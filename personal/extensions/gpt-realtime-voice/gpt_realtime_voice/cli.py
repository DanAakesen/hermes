"""CLI registration for ``hermes voice``."""

from __future__ import annotations

import argparse

from .config import VoiceRuntimeConfig


def _setup_parser(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "action",
        nargs="?",
        choices=("serve",),
        default="serve",
        help="Start the local realtime voice client",
    )
    parser.add_argument("--host", default="127.0.0.1", help="Loopback host (Milestone 1 only)")
    parser.add_argument("--port", type=int, default=8765, help="Local HTTP port")
    parser.add_argument("--model", default="gpt-realtime-2.1", help="OpenAI Realtime model")
    parser.add_argument("--voice", default="marin", help="OpenAI Realtime voice")
    parser.add_argument(
        "--transcription-model",
        default="gpt-4o-mini-transcribe",
        help="Input transcription model inside the Realtime session",
    )
    parser.add_argument("--open", action="store_true", help="Open the client in the default browser")
    parser.set_defaults(func=_handle_command)


def _handle_command(args: argparse.Namespace) -> None:
    from .server import run_server

    config = VoiceRuntimeConfig(
        host=args.host,
        port=args.port,
        realtime_model=args.model,
        transcription_model=args.transcription_model,
        voice=args.voice,
    )
    run_server(config, open_browser=args.open)


def register_cli(ctx) -> None:
    ctx.register_cli_command(
        name="voice",
        help="Start the personal realtime voice client",
        description="Realtime WebRTC voice surface backed by the Hermes agent",
        setup_fn=_setup_parser,
        handler_fn=_handle_command,
    )
