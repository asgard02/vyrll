#!/usr/bin/env python3
"""Intro snap for the local clip FX lab: camera flash + Mixkit flash pop.

Sound is the electric flash fire (not a shutter click), from the
video-shotcraft GitHub Mixkit pack. Visual is a brief photo bloom.
Production render is untouched.
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np

FLASH_PEAK_T = 0.024
FLASH_END_T = 0.20
FLASH_PEAK_ALPHA = 0.34
# Slightly warm, like a xenon tube — not a pure white overlay.
FLASH_BGR = (255.0, 248.0, 236.0)

SFX_DIR = Path(__file__).resolve().parent / "sfx"
CAMERA_DIR = SFX_DIR / "camera"
DEFAULT_SHUTTER_ID = "flash"

# Flash fire (electric pop), not mechanical shutter click.
# From GitHub video-shotcraft Mixkit pack.
SHUTTER_PACK: tuple[dict[str, str], ...] = (
    {
        "id": "flash",
        "label": "Flash (pop)",
        "file": "flash-pop.wav",
    },
    {
        "id": "spark",
        "label": "Flash (étincelle)",
        "file": "flash-spark.wav",
    },
    {
        "id": "vintage",
        "label": "Clic shutter",
        "file": "vintage.wav",
    },
)

_glow_cache: dict[tuple[int, int], np.ndarray] = {}


def shutter_catalog() -> list[dict[str, str]]:
    return [{"id": s["id"], "label": s["label"]} for s in SHUTTER_PACK]


def intro_flash_strength(t: float) -> float:
    """0→1 envelope. 1–2 frame attack, photo-flash decay. 0 outside the window."""
    if t < 0.0 or t >= FLASH_END_T:
        return 0.0
    if t <= FLASH_PEAK_T:
        return math.sqrt(t / FLASH_PEAK_T)
    u = (t - FLASH_PEAK_T) / (FLASH_END_T - FLASH_PEAK_T)
    return math.exp(-6.2 * u)


def _glow_field(h: int, w: int) -> np.ndarray:
    """Center-weighted bloom (real flash), not an edge ring."""
    key = (h, w)
    cached = _glow_cache.get(key)
    if cached is not None:
        return cached
    yy, xx = np.mgrid[0:h, 0:w]
    nx = (xx - (w - 1) / 2.0) / max(w / 2.0, 1.0)
    ny = (yy - (h - 1) / 2.0) / max(h / 2.0, 1.0)
    r = np.sqrt(nx * nx + ny * ny)
    field = np.clip(1.0 - 0.38 * r, 0.55, 1.0).astype(np.float32)
    _glow_cache[key] = field
    return field


def apply_intro_flash(frame: np.ndarray, t: float) -> np.ndarray:
    """Blend a warm luminous burst onto BGR `frame`. Identity outside the snap."""
    s = intro_flash_strength(t)
    if s <= 0.004 or frame is None or frame.size == 0:
        return frame
    h, w = frame.shape[:2]
    alpha = np.float32(FLASH_PEAK_ALPHA * s) * _glow_field(h, w)
    if frame.ndim == 3:
        alpha = alpha[:, :, None]
    out = frame.astype(np.float32)
    flash = np.array(FLASH_BGR, dtype=np.float32).reshape(1, 1, 3)
    out = out * (1.0 - alpha) + flash * alpha
    return np.clip(out, 0, 255).astype(np.uint8)


def ensure_camera_shutter_wav(shutter_id: str | None = None, path: Path | None = None) -> Path:
    """Packaged Mixkit/GitHub shutter (lab only)."""
    if path is not None:
        dest = path
    else:
        sid = (shutter_id or DEFAULT_SHUTTER_ID).strip().lower()
        rec = next((s for s in SHUTTER_PACK if s["id"] == sid), None)
        if rec is None:
            rec = next(s for s in SHUTTER_PACK if s["id"] == DEFAULT_SHUTTER_ID)
        dest = CAMERA_DIR / rec["file"]
    if dest.is_file() and dest.stat().st_size > 800:
        return dest
    raise FileNotFoundError(f"Missing shutter at {dest}. See sfx/ATTRIBUTION.md")


def ffmpeg_amix_filter() -> str:
    """Mix VOD audio [1] with shutter [2]; keep VOD duration. Quiet overlay."""
    return (
        "[1:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[base];"
        "[2:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=0.45[sfx];"
        "[base][sfx]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]"
    )
