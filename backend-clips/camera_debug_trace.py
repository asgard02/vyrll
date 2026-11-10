"""Camera traces that exist only when CAMERA_DEBUG_TRACE=1.

Any other value, including an unset variable, leaves logs and files untouched.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

_PATH: Path | None = None


def enabled() -> bool:
    return os.environ.get("CAMERA_DEBUG_TRACE") == "1"


def set_output_path(output_path: str | None) -> None:
    """Open `<output_path>.camtrace.jsonl` beside the render, or close the sink."""
    global _PATH
    if not enabled() or not output_path:
        _PATH = None
        return
    path = Path(str(output_path) + ".camtrace.jsonl")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("", encoding="utf-8")
    _PATH = path


def reset() -> None:
    """Drop the sink. Used by tests so a flag cannot leak into another case."""
    global _PATH
    _PATH = None


def emit(stage: str, **fields: object) -> None:
    """Print one new CAMTRACE stage and append the same JSON object to the file."""
    if not enabled():
        return
    payload = {key: value for key, value in fields.items() if value is not None}
    text = json.dumps(
        {"stage": stage, **payload},
        ensure_ascii=False,
        separators=(",", ":"),
        default=str,
    )
    print("[CAMTRACE] " + text, flush=True)
    append_json(text)


def append_json(payload: str) -> None:
    """Copy one already printed CAMTRACE JSON object into the file, without printing again."""
    if not enabled() or _PATH is None:
        return
    with _PATH.open("a", encoding="utf-8") as handle:
        handle.write(payload + "\n")
