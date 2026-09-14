#!/usr/bin/env python3
"""Génère les thumbs du picker (vrai Pillow) → ../public/look-previews/."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

import preview_subtitles as lab
import hook_title_styles as titles

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "look-previews"

SUB_STYLES = lab.NEW_STYLES
TITLE_STYLES = titles.STYLE_IDS
THUMB_W = 800
THUMB_H = 450


def _alpha_box(overlay: np.ndarray) -> tuple[int, int, int, int] | None:
    ys, xs = np.nonzero(overlay[:, :, 3] > 8)
    if ys.size == 0:
        return None
    return int(ys.min()), int(ys.max()) + 1, int(xs.min()), int(xs.max()) + 1


def _padded_box(
    y0: int, y1: int, x0: int, x1: int, h: int, w: int, pad: float
) -> tuple[int, int, int, int]:
    bh = max(1, y1 - y0)
    bw = max(1, x1 - x0)
    y0 = max(0, y0 - int(bh * pad))
    y1 = min(h, y1 + int(bh * pad))
    x0 = max(0, x0 - int(bw * pad))
    x1 = min(w, x1 + int(bw * pad))
    return y0, y1, x0, x1


def _thumb(
    composed: np.ndarray, overlay: np.ndarray, pad: float, zoom: float
) -> Image.Image:
    """Crop around the text, then scale up so glyphs fill more of the thumb."""
    box = _alpha_box(overlay)
    h, w, _ = composed.shape
    if box is None:
        y0, y1, x0, x1 = int(h * 0.55), int(h * 0.95), 0, w
    else:
        y0, y1, x0, x1 = _padded_box(*box, h, w, pad)
    crop = composed[y0:y1, x0:x1]
    img = Image.fromarray(crop, mode="RGB")
    scale = min(THUMB_W / img.width, THUMB_H / img.height) * max(1.0, zoom)
    nw = max(1, int(round(img.width * scale)))
    nh = max(1, int(round(img.height * scale)))
    img = img.resize((nw, nh), Image.Resampling.LANCZOS)
    left = max(0, (img.width - THUMB_W) // 2)
    top = max(0, (img.height - THUMB_H) // 2)
    img = img.crop(
        (left, top, left + min(THUMB_W, img.width), top + min(THUMB_H, img.height))
    )
    canvas = Image.new("RGB", (THUMB_W, THUMB_H), (28, 24, 22))
    canvas.paste(img, ((THUMB_W - img.width) // 2, (THUMB_H - img.height) // 2))
    return canvas


def _save(img: Image.Image, name: str) -> None:
    path = OUT / name
    img.save(path, format="JPEG", quality=88, subsampling=1, optimize=True)
    print(f"  {path.relative_to(ROOT)}  {path.stat().st_size // 1024}k")


def _times_for(style: str) -> list[float]:
    rs = lab._load_module()
    blocks = lab._blocks_for_style(rs, style)
    times: list[float] = []
    karaoke = style in ("impact", "neon")
    # Bulle = un cartouche fixe (toute la phrase), jamais 3 battements karaoké.
    if style == "bubble" and blocks:
        def _bloc_text(b: dict) -> str:
            return " ".join(str(w.get("word") or "") for w in (b.get("words") or []))

        best = max(blocks, key=lambda b: len(_bloc_text(b)))
        t0 = (float(best.get("bloc_start") or 0) + float(best.get("bloc_end") or 0)) / 2
        return [t0, t0, t0]
    if karaoke:
        for bloc in blocks[:2]:
            for w in (bloc.get("words") or [])[:2]:
                t0 = float(w.get("start") or 0)
                t1 = float(w.get("end") or t0)
                times.append((t0 + t1) / 2)
                if len(times) >= 3:
                    break
            if len(times) >= 3:
                break
    else:
        for bloc in blocks[:3]:
            t0 = float(bloc.get("bloc_start") or 0)
            t1 = float(bloc.get("bloc_end") or t0)
            times.append((t0 + t1) / 2)
    while len(times) < 3:
        times.append(times[-1] + 0.4 if times else 0.5)
    return times[:3]


def _compose(overlay: np.ndarray, bg: np.ndarray) -> np.ndarray:
    alpha = overlay[:, :, 3:4].astype(np.float32) / 255.0
    rgb = overlay[:, :, :3].astype(np.float32)
    return (rgb * alpha + bg.astype(np.float32) * (1.0 - alpha)).astype(np.uint8)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    rs = lab._load_module()
    font_path = rs._resolve_font_path(None)
    bg = lab._background()
    print("sous-titres")
    for style in SUB_STYLES:
        for i, t in enumerate(_times_for(style)):
            bloc = rs.get_bloc_at_with_silence_gate(t, lab._blocks_for_style(rs, style))
            if bloc is None:
                overlay = np.zeros((lab.FRAME_H, lab.FRAME_W, 4), dtype=np.uint8)
            else:
                overlay = rs.render_subtitle_frame(
                    lab.FRAME_W,
                    lab.FRAME_H,
                    bloc,
                    rs.get_word_at(t, bloc),
                    style,
                    font_path,
                    layout_mode="normal",
                )
            composed = _compose(overlay, bg)
            if style in ("impact", "neon"):
                zoom = 1.12
            elif style == "bubble":
                zoom = 1.16
            else:
                zoom = 1.24
            _save(_thumb(composed, overlay, pad=0.14, zoom=zoom), f"sub-{style}-{i}.jpg")
    print("titres")
    tbg = lab._title_background()
    for style in TITLE_STYLES:
        overlay = titles.render_hook_title(lab.FRAME_W, lab.FRAME_H, titles.SAMPLE_HOOK, style)
        if overlay is None:
            overlay = np.zeros((lab.FRAME_H, lab.FRAME_W, 4), dtype=np.uint8)
        composed = _compose(overlay, tbg)
        _save(_thumb(composed, overlay, pad=0.16, zoom=1.22), f"title-{style}.jpg")
    print("ok", OUT)


if __name__ == "__main__":
    sys.exit(main() or 0)
