"""Hermes registration for the personal realtime voice plugin."""

if __package__:
    from .gpt_realtime_voice.cli import register_cli
else:  # Pytest collects hyphenated plugin roots as a standalone module.
    from gpt_realtime_voice.cli import register_cli


def register(ctx) -> None:
    """Register the plugin's terminal command without adding model tools."""

    register_cli(ctx)
