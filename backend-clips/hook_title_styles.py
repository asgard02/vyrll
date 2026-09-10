"""DA du titre des 3 premières secondes (hook).

Branché à la prod via --hook-style / render_hook_title_card(variant=...).
"""

from __future__ import annotations

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

import render_subtitles as rs

SAMPLE_HOOK = "What if AI brings unlimited wealth for everyone?"

STYLES: tuple[tuple[str, str, str], ...] = (
    ("actuel", "Actuel", "Bandeau blanc, texte noir — ce qu'on a aujourd'hui."),
    ("magazine", "Magazine", "Sans boîte. Inter + un mot Playfair italique."),
    ("stroke", "Contour", "Gros sans blanc, contour noir, comme un titre de miniature."),
    ("kicker", "Kicker", "Titre serif à gauche, filet au-dessus. Toute la phrase."),
    ("marker", "Surligneur", "Tout blanc, un mot marqué au feutre jaune."),
    ("tape", "Scotch", "Morceau de papier crème, légèrement de travers."),
)

LABELS = {k: label for k, label, _ in STYLES}
NOTES = {k: note for k, _, note in STYLES}
STYLE_IDS = tuple(k for k, _, _ in STYLES)


def _words(text: str) -> list[str]:
    return [w for w in (text or "").split() if w]


def _fit_wrap(text: str, draw, font_path: str, sizes: list[int], max_w: float, max_lines: int, loader=None):
    load = loader or rs._load_font
    best = None
    for fs in sizes:
        font = load(font_path, fs)
        lines = rs._wrap_plain_text(text, draw, font, max_w)
        if len(lines) <= max_lines:
            return font, lines
        if best is None or len(lines) < len(best[1]):
            best = (font, lines)
    if best is None:
        font = load(font_path, sizes[-1] if sizes else 48)
        return font, rs._wrap_plain_text(text, draw, font, max_w)
    return best


def _line_h(draw, font) -> tuple[int, int, int]:
    try:
        ref = draw.textbbox((0, 0), "Hg", font=font)
        return int(ref[3] - ref[1]), int(ref[0]), int(ref[1])
    except Exception:
        return int(rs._font_px(font)), 0, 0


def _block_size(draw, lines: list[str], font, gap: int) -> tuple[float, int, int, int]:
    lh, left, top = _line_h(draw, font)
    max_w = 0.0
    for line in lines:
        max_w = max(max_w, rs._textlength(draw, line, font))
    h = lh * len(lines) + gap * max(0, len(lines) - 1)
    return max_w, h, left, top


def _emphasis_index(words: list[str]) -> int:
    payload = [{"word": w} for w in words]
    return rs._editorial_emphasis_index(payload)


def render_hook_title(
    width: int,
    height: int,
    text: str,
    variant: str,
) -> np.ndarray | None:
    text = rs.filter_emojis((text or "").strip())
    if not text:
        return None
    variant = variant if variant in STYLE_IDS else "actuel"
    if variant == "actuel":
        font_path = rs._resolve_font_path(None)
        return rs.render_hook_title_card(width, height, text, font_path)
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    if variant == "magazine":
        _draw_magazine(draw, width, height, text)
    elif variant == "stroke":
        _draw_stroke(draw, width, height, text)
    elif variant == "kicker":
        _draw_kicker(draw, width, height, text)
    elif variant == "marker":
        _draw_marker(draw, width, height, text)
    elif variant == "tape":
        img = _draw_tape(width, height, text)
    return np.array(img)


def _draw_magazine(draw, width: int, height: int, text: str) -> None:
    words = _words(text)
    sans_path = rs._bundled_font("Inter-Regular.otf", "Inter-Medium.otf")
    italic_path = rs._bundled_font("PlayfairDisplay-Italic.ttf")
    sizes = [int(width * s) for s in (0.078, 0.068, 0.058, 0.050)]
    dummy = [{"word": w} for w in words]
    lines, sans, line_h, _margin = rs._fit_wrap_single_font(
        dummy, width, sans_path, draw, sizes,
        margin_ratio=0.10, max_lines=3, line_h_ratio=1.12,
    )
    italic = rs._load_font(italic_path, int(getattr(sans, "size", 56)))
    italic_dy = (rs._font_cap_top(draw, sans) - rs._font_cap_top(draw, italic)) + 2
    emph_i = _emphasis_index(words)
    flat = [w for line in lines for w in line]
    emph_obj = flat[emph_i] if 0 <= emph_i < len(flat) else None

    y = height * 0.14
    fill = (255, 255, 255, 255)
    for line in lines:
        def adv(w):
            f = italic if w is emph_obj else sans
            return rs._textlength(draw, str(w.get("word") or "") + " ", f)

        line_w = sum(adv(w) for w in line)
        if line:
            last_f = italic if line[-1] is emph_obj else sans
            line_w -= rs._textlength(draw, " ", last_f)
        x = (width - line_w) / 2
        for w in line:
            word = str(w.get("word") or "")
            f = italic if w is emph_obj else sans
            yw = y + italic_dy if w is emph_obj else y
            rs._draw_fill_text(draw, (x + 1, yw + 3), word, f, (0, 0, 0, 140))
            rs._draw_fill_text(draw, (x, yw), word, f, fill)
            x += rs._textlength(draw, word + " ", f)
        y += line_h


def _draw_stroke(draw, width: int, height: int, text: str) -> None:
    font_path = rs._bundled_font("Montserrat-BlackStatic.ttf", "Anton-Regular.ttf")
    max_w = width * 0.86
    sizes = [int(width * s) for s in (0.092, 0.080, 0.070, 0.060, 0.052)]
    font, lines = _fit_wrap(text, draw, font_path, sizes, max_w, 2, loader=rs._load_title_font)
    gap = max(4, int(rs._font_px(font) * 0.08))
    _max_w, _block_h, left, top = _block_size(draw, lines, font, gap)
    y = height * 0.13
    radius = max(6, int(rs._font_px(font) * 0.08))
    for line in lines:
        lw = rs._textlength(draw, line, font)
        x = (width - lw) / 2 - left
        rs._draw_outlined_text(
            draw, (x, y - top), line, font, (255, 255, 255, 255),
            outline_rgb=(0, 0, 0), outline_radius=radius, shadow=True,
        )
        y += _line_h(draw, font)[0] + gap


def _draw_kicker(draw, width: int, height: int, text: str) -> None:
    serif_path = rs._bundled_font("PlayfairDisplay-Regular.ttf")
    max_w = width * 0.78
    sizes = [int(width * s) for s in (0.086, 0.074, 0.062, 0.052)]
    serif, lines = _fit_wrap(text, draw, serif_path, sizes, max_w, 3)
    left = width * 0.10
    y = height * 0.13
    rule_w = max(width * 0.16, min(width * 0.28, rs._textlength(draw, lines[0], serif) * 0.42))
    draw.rectangle([left, y, left + rule_w, y + 3], fill=(255, 255, 255, 210))
    y += int(height * 0.016)
    gap = max(2, int(rs._font_px(serif) * 0.06))
    lh, _left_b, top = _line_h(draw, serif)
    for line in lines:
        rs._draw_fill_text(draw, (left + 2, y - top + 3), line, serif, (0, 0, 0, 130))
        rs._draw_fill_text(draw, (left, y - top), line, serif, (255, 255, 255, 255))
        y += lh + gap


def _draw_marker(draw, width: int, height: int, text: str) -> None:
    words = _words(text)
    dummy = [{"word": w} for w in words]
    sans_path = rs._bundled_font("Inter-Medium.otf", "Inter-Regular.otf")
    sizes = [int(width * s) for s in (0.072, 0.062, 0.054, 0.046)]
    lines, font, line_h, _m = rs._fit_wrap_single_font(
        dummy, width, sans_path, draw, sizes,
        margin_ratio=0.10, max_lines=3, line_h_ratio=1.28,
    )
    flat = [w for line in lines for w in line]
    emph_i = _emphasis_index(words)
    emph_obj = flat[emph_i] if 0 <= emph_i < len(flat) else None
    y = height * 0.15
    for line in lines:
        line_w = sum(rs._textlength(draw, str(w.get("word") or "") + " ", font) for w in line)
        if line:
            line_w -= rs._textlength(draw, " ", font)
        x = (width - line_w) / 2
        for w in line:
            word = str(w.get("word") or "")
            tw = rs._textlength(draw, word, font)
            if w is emph_obj:
                x += max(12, int(tw * 0.08))
                bbox = draw.textbbox((x, y), word, font=font)
                pad_l = max(6, int(tw * 0.05))
                pad_r = max(10, int(tw * 0.08))
                pad_y = max(6, int((bbox[3] - bbox[1]) * 0.16))
                draw.rounded_rectangle(
                    [bbox[0] - pad_l, bbox[1] - pad_y, bbox[2] + pad_r, bbox[3] + pad_y],
                    radius=max(6, int((bbox[3] - bbox[1]) * 0.22)),
                    fill=(255, 224, 70, 235),
                )
                rs._draw_fill_text(draw, (x, y), word, font, (20, 18, 16, 255))
            else:
                rs._draw_fill_text(draw, (x + 1, y + 2), word, font, (0, 0, 0, 130))
                rs._draw_fill_text(draw, (x, y), word, font, (255, 255, 255, 255))
            x += rs._textlength(draw, word + " ", font)
        y += line_h


def _draw_tape(width: int, height: int, text: str) -> Image.Image:
    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    font_path = rs._bundled_font("Inter-Medium.otf", "Inter-Regular.otf")
    max_w = width * 0.78
    sizes = [int(width * s) for s in (0.062, 0.056, 0.050, 0.044)]
    font, lines = _fit_wrap(text, draw, font_path, sizes, max_w, 2)
    gap = max(4, int(rs._font_px(font) * 0.10))
    text_w, block_h, left, top = _block_size(draw, lines, font, gap)
    pad_x = int(width * 0.05)
    pad_y = int(height * 0.018)
    box_w = min(width * 0.88, text_w + 2 * pad_x)
    box_h = block_h + 2 * pad_y
    box_x = (width - box_w) / 2
    box_y = height * 0.13
    draw.rounded_rectangle(
        [box_x, box_y, box_x + box_w, box_y + box_h],
        radius=max(8, int(box_h * 0.12)),
        fill=(245, 238, 220, 245),
    )
    y = box_y + pad_y
    for line in lines:
        lw = rs._textlength(draw, line, font)
        x = box_x + (box_w - lw) / 2 - left
        rs._draw_fill_text(draw, (x, y - top), line, font, (28, 24, 20, 255))
        y += _line_h(draw, font)[0] + gap
    rotated = layer.rotate(-2.4, resample=Image.Resampling.BICUBIC, center=(width / 2, box_y + box_h / 2))
    canvas.alpha_composite(rotated)
    return canvas


def video_background(width: int, height: int) -> np.ndarray:
    """Fond 9:16 type plan serré, pour juger le titre au-dessus du visage."""
    img = Image.new("RGB", (width, height), (28, 24, 22))
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, 0, width, int(height * 0.42)], fill=(48, 38, 34))
    draw.ellipse(
        [int(width * 0.18), int(height * 0.38), int(width * 0.82), int(height * 1.15)],
        fill=(62, 48, 42),
    )
    draw.ellipse(
        [int(width * 0.32), int(height * 0.40), int(width * 0.68), int(height * 0.68)],
        fill=(92, 72, 62),
    )
    img = img.filter(ImageFilter.GaussianBlur(radius=18))
    return np.array(img)
