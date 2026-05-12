#!/usr/bin/env python3
"""
Rendu de sous-titres dynamiques style TikTok — Pillow + FFmpeg pipe.
Remplace ASS/karaoké pour éviter les bugs de balises.
"""

import argparse
import json
import math
import os
import re
import subprocess
import sys
import threading
import time
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from scipy.ndimage import gaussian_filter1d
from PIL import Image, ImageDraw, ImageFont

EMOJI_REGEX = re.compile(
    r"[\U0001F300-\U0001F9FF\U00002600-\U000026FF\U00002700-\U000027BF]"
)

# Style Reese's / MrBeast : contour uniforme, mot actif coloré (aligné avec src/lib/subtitle-style-colors.ts)
STYLE_COLORS = {
    "karaoke":   {"active": "#22C55E", "inactive": "#FFFFFF", "contour": "#000000"},
    "impact":    {"active": "#BEFF00", "inactive": "#FFFFFF", "contour": "#000000"},
    "highlight": {"active": "#F43F5E", "inactive": "#FFFFFF", "contour": "#000000"},
    "minimal":   {"active": "#A78BFA", "inactive": "#E8E4F0", "contour": "#000000"},
    "neon":      {"active": "#D946EF", "inactive": "#F5F3FF", "contour": "#000000"},
    "boxed":     {"active": "#6D28D9", "inactive": "#FFFFFF", "contour": "#000000"},
    "ocean":     {"active": "#0891B2", "inactive": "#E0F2FE", "contour": "#000000"},
    "sunset":    {"active": "#EA580C", "inactive": "#FFF7ED", "contour": "#000000"},
    "slate":     {"active": "#475569", "inactive": "#CBD5E1", "contour": "#0F172A"},
    "berry":     {"active": "#BE123C", "inactive": "#FCE7F3", "contour": "#000000"},
}


def filter_emojis(text: str) -> str:
    return EMOJI_REGEX.sub("", text).strip() or " "


def get_words_in_range(transcription: dict, clip_start: float, clip_end: float) -> list:
    """Extrait les mots dans l'intervalle du clip."""
    words = []
    raw_words = transcription.get("words")
    if not raw_words and transcription.get("segments"):
        raw_words = []
        for seg in transcription["segments"]:
            raw_words.extend(seg.get("words") or [])
    if raw_words:
        for w in raw_words:
            if w.get("end", 0) > clip_start and w.get("start", 0) < clip_end:
                word = filter_emojis(str(w.get("word", "")).strip())
                if not word:
                    continue
                words.append({
                    "word": word.upper(),
                    "start": max(0, (w.get("start", 0) or 0) - clip_start),
                    "end": min(clip_end - clip_start, (w.get("end", 0) or 0) - clip_start),
                })
    if not words and transcription.get("segments"):
        for seg in transcription["segments"]:
            s = seg.get("start", 0) or 0
            e = seg.get("end", s + 1) or s + 1
            if e <= clip_start or s >= clip_end:
                continue
            rel_start = max(0, s - clip_start)
            rel_end = min(clip_end - clip_start, e - clip_start)
            text = filter_emojis(str(seg.get("text", "")).strip())
            if not text:
                continue
            tokens = text.split()
            span = rel_end - rel_start
            step = span / len(tokens) if tokens else 0
            for i, t in enumerate(tokens):
                words.append({
                    "word": t.upper(),
                    "start": rel_start + i * step,
                    "end": rel_start + (i + 1) * step,
                })
    # Merge apostrophes: Whisper often outputs ["j'", "ai"] as separate tokens
    i = len(words) - 1
    while i >= 0:
        if words[i]["word"].endswith("'") and i + 1 < len(words):
            words[i]["word"] = words[i]["word"] + words[i + 1]["word"]
            words[i]["end"] = words[i + 1]["end"]
            words.pop(i + 1)
        i -= 1
    return words


def group_into_blocks(words: list, max_per_block: int = 4, min_block_duration: float = 0.0) -> list:
    """Groupe les mots en blocs. min_block_duration garantit une durée minimale d'affichage."""
    blocks = []
    for i in range(0, len(words), max_per_block):
        chunk = words[i : i + max_per_block]
        if chunk:
            bloc_end = chunk[-1]["end"]
            if min_block_duration > 0:
                bloc_end = max(bloc_end, chunk[0]["start"] + min_block_duration)
            blocks.append({
                "words": chunk,
                "bloc_start": chunk[0]["start"],
                "bloc_end": bloc_end,
            })
    return blocks


def get_bloc_at(t: float, blocks: list) -> dict | None:
    for b in blocks:
        if b["bloc_start"] <= t <= b["bloc_end"]:
            return b
    return None


def get_bloc_at_or_nearest(t: float, blocks: list) -> dict | None:
    """Retourne le bloc à t, ou le plus proche (évite que les sous-titres disparaissent entre deux blocs)."""
    if not blocks:
        return None
    for b in blocks:
        if b["bloc_start"] <= t <= b["bloc_end"]:
            return b
    # Entre deux blocs : garder le bloc précédent (celui qui vient de se terminer) ou le suivant
    last_before = None
    first_after = None
    for b in blocks:
        if b["bloc_end"] <= t:
            last_before = b
        if b["bloc_start"] >= t and first_after is None:
            first_after = b
    return last_before if last_before is not None else first_after


def get_word_at(t: float, bloc: dict) -> dict | None:
    for w in bloc["words"]:
        if w["start"] <= t <= w["end"]:
            return w
    return None


def get_bloc_at_with_silence_gate(t: float, blocks: list, silence_threshold: float = 0.4) -> dict | None:
    """Like get_bloc_at_or_nearest but hides subtitles during long silence gaps (> threshold)."""
    for b in blocks:
        if b["bloc_start"] <= t <= b["bloc_end"]:
            return b
    last_before = None
    first_after = None
    for b in blocks:
        if b["bloc_end"] <= t:
            last_before = b
        if b["bloc_start"] >= t and first_after is None:
            first_after = b
    if last_before is not None and first_after is not None:
        gap = first_after["bloc_start"] - last_before["bloc_end"]
        if gap <= silence_threshold:
            return last_before
        return None
    return last_before if last_before is not None else first_after


def _textlength(draw, text: str, font) -> float:
    try:
        return draw.textlength(text, font=font)
    except TypeError:
        bbox = draw.textbbox((0, 0), text, font=font)
        return bbox[2] - bbox[0]


def _load_title_font(font_path: str, size: int):
    """Montserrat variable → poids Black ; police statique → inchangée."""
    try:
        f = ImageFont.truetype(font_path, size)
    except OSError:
        return ImageFont.load_default()
    if hasattr(f, "set_variation_by_name"):
        try:
            f.set_variation_by_name("Black")
        except (OSError, ValueError):
            pass
    return f


def _word_font(word: str, font_large, font_small):
    return font_small if len(word) > 10 else font_large


def _line_width_total(draw, line_words, font_large, font_small) -> float:
    return sum(
        _textlength(
            draw,
            w["word"] + " ",
            _word_font(w["word"], font_large, font_small),
        )
        for w in line_words
    )


def _wrap_words_into_lines(words_data: list, max_line_w: float, draw, font_large, font_small) -> list:
    """Découpe en lignes sans dépasser max_line_w (greedy)."""
    lines = []
    cur = []
    cur_w = 0.0
    for w in words_data:
        f = _word_font(w["word"], font_large, font_small)
        piece_w = _textlength(draw, w["word"] + " ", f)
        if cur and cur_w + piece_w > max_line_w + 0.5:
            lines.append(cur)
            cur = [w]
            cur_w = piece_w
        else:
            cur.append(w)
            cur_w += piece_w
    if cur:
        lines.append(cur)
    return lines


def _layout_subtitle_lines(words_data: list, width: int, font_path: str, is_split: bool, draw):
    """
    Largeur max par ligne avec marge (contour + pilule). Réduit la taille de police
    jusqu'à ce que chaque ligne tienne, ou jusqu'à une taille minimale.
    """
    margin_x = 0.08
    max_line_w = width * (1 - 2 * margin_x)
    font_size = 78 if is_split else 92
    font_small = 64 if is_split else 74
    min_fs = 32
    min_sm = 26
    max_lines = 4

    while True:
        font = _load_title_font(font_path, font_size)
        font_small_obj = _load_title_font(font_path, font_small)
        lines = _wrap_words_into_lines(words_data, max_line_w, draw, font, font_small_obj)
        over = len(lines) > max_lines
        if not over:
            for line in lines:
                if _line_width_total(draw, line, font, font_small_obj) > max_line_w + 1.0:
                    over = True
                    break
        if not over:
            line_height = max(int(font_size * 1.12), 72)
            return lines, font, font_small_obj, line_height
        if font_size <= min_fs and font_small <= min_sm:
            break
        nxt = max(int(font_size * 0.9), min_fs)
        smt = max(int(font_small * 0.9), min_sm)
        if nxt == font_size and smt == font_small:
            break
        font_size, font_small = nxt, smt

    font = _load_title_font(font_path, min_fs)
    font_small_obj = _load_title_font(font_path, min_sm)
    lines = _wrap_words_into_lines(words_data, max_line_w, draw, font, font_small_obj)
    line_height = max(int(min_fs * 1.12), 72)
    return lines, font, font_small_obj, line_height


# Contour : 4 directions cardinales uniquement, déplacement max 3 px
OUTLINE_OFFSET_PX = 3


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def _render_impact_frame(
    width: int,
    height: int,
    bloc: dict,
    active_word: dict | None,
    style: str,
    font_path: str,
    layout_mode: str = "normal",
) -> np.ndarray:
    """Impact : 2-3 mots par bloc, très grands, centrés. Mot actif coloré, inactifs en blanc."""
    colors = STYLE_COLORS.get(style, STYLE_COLORS["karaoke"])
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    words_data = bloc.get("words", [])
    if not words_data:
        return np.array(img)

    is_split = layout_mode == "split_vertical"
    margin_x = int(width * 0.07)
    max_line_w = width - 2 * margin_x
    active_rgb = _hex_to_rgb(colors["active"])

    # Auto-scale : réduire la police jusqu'à ce que la ligne la plus large rentre
    for font_size in ([90, 80, 70, 60, 50, 40] if is_split else [130, 115, 100, 85, 70, 55]):
        font = _load_title_font(font_path, font_size)
        line_h = int(font_size * 1.2)

        # Wrap words into lines
        lines: list[list[dict]] = []
        cur: list[dict] = []
        cur_w = 0.0
        for w in words_data:
            word_w = _textlength(draw, w["word"] + " ", font)
            if cur and cur_w + word_w > max_line_w + 1:
                lines.append(cur)
                cur = [w]
                cur_w = word_w
            else:
                cur.append(w)
                cur_w += word_w
        if cur:
            lines.append(cur)

        # Check all lines fit
        fits = all(
            _textlength(draw, " ".join(w["word"] for w in line), font) <= max_line_w
            for line in lines
        )
        if fits:
            break

    total_h = len(lines) * line_h
    safe_bottom = int(height * 0.78)
    y_base = safe_bottom - total_h

    for line_words in lines:
        line_text_w = _textlength(draw, " ".join(w["word"] for w in line_words), font)
        x = (width - line_text_w) / 2

        for w in line_words:
            word = w["word"]
            is_active = active_word is not None and word == active_word["word"]
            word_w = _textlength(draw, word, font)

            # Ombre portée
            for off, alpha in [(6, 50), (4, 90), (2, 140)]:
                draw.text((x + off, y_base + off), word, font=font, fill=(0, 0, 0, alpha))

            # Contour
            o = 4
            fill_color = (*active_rgb, 255) if is_active else (255, 255, 255, 255)
            for dx, dy in ((0, o), (0, -o), (o, 0), (-o, 0)):
                draw.text((x + dx, y_base + dy), word, font=font, fill=(0, 0, 0, 255))

            draw.text((x, y_base), word, font=font, fill=fill_color)
            x += word_w + _textlength(draw, " ", font)

        y_base += line_h

    return np.array(img)


def _render_boxed_frame(
    width: int,
    height: int,
    bloc: dict,
    active_word: dict | None,
    style: str,
    font_path: str,
    layout_mode: str = "normal",
) -> np.ndarray:
    """Boxed : fond coloré semi-transparent derrière le bloc de texte, tout en blanc."""
    colors = STYLE_COLORS.get(style, STYLE_COLORS["karaoke"])
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    is_split = layout_mode == "split_vertical"
    words_data = bloc["words"]

    lines, font, font_small_obj, line_height = _layout_subtitle_lines(
        words_data, width, font_path, is_split, draw
    )

    safe_bottom = int(height * 0.72)
    n_lines = len(lines)
    y_base = safe_bottom - (line_height * n_lines)

    max_line_w = max(
        _line_width_total(draw, line, font, font_small_obj) for line in lines
    ) if lines else 0

    pad_x, pad_y, box_radius = 28, 16, 18
    box_x1 = (width - max_line_w) / 2 - pad_x
    box_y1 = y_base - pad_y
    box_x2 = (width + max_line_w) / 2 + pad_x
    box_y2 = safe_bottom + pad_y

    active_rgb = _hex_to_rgb(colors["active"])
    draw.rounded_rectangle(
        [box_x1, box_y1, box_x2, box_y2],
        radius=box_radius,
        fill=(*active_rgb, 210),
    )

    for line_idx, line_words in enumerate(lines):
        line_width = _line_width_total(draw, line_words, font, font_small_obj)
        x = (width - line_width) / 2
        y = y_base + line_idx * line_height

        for word_obj in line_words:
            word = word_obj["word"]
            is_active = active_word and word == active_word["word"]
            f = font_small_obj if len(word) > 10 else font
            fill = (255, 255, 255, 255) if is_active else (220, 220, 220, 195)
            draw.text((x, y), word, font=f, fill=fill)
            x += _textlength(draw, word + " ", f)

    return np.array(img)


STYLE_VARIANTS = {
    "karaoke":   "pill",
    "impact":    "impact",
    "highlight": "marker",
    "neon":      "glow",
    "boxed":     "boxed",
    "sunset":    "gradient",
    "ocean":     "pill",
    "minimal":   "minimal",
    "slate":     "minimal",
    "berry":     "pill",
}


def _render_marker_frame(
    width: int,
    height: int,
    bloc: dict,
    active_word: dict | None,
    style: str,
    font_path: str,
    layout_mode: str = "normal",
) -> np.ndarray:
    """Marker/Highlight : fond surligneur rectangulaire (comme un feutre) sur le mot actif."""
    colors = STYLE_COLORS.get(style, STYLE_COLORS["karaoke"])
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    is_split = layout_mode == "split_vertical"
    words_data = bloc["words"]
    lines, font, font_small_obj, line_height = _layout_subtitle_lines(
        words_data, width, font_path, is_split, draw
    )
    safe_bottom = int(height * 0.72)
    n_lines = len(lines)
    y_base = safe_bottom - (line_height * n_lines)
    active_rgb = _hex_to_rgb(colors["active"])

    for line_idx, line_words in enumerate(lines):
        line_width = _line_width_total(draw, line_words, font, font_small_obj)
        x = (width - line_width) / 2
        y = y_base + line_idx * line_height

        for word_obj in line_words:
            word = word_obj["word"]
            is_active = active_word and word == active_word["word"]
            f = _word_font(word, font, font_small_obj)
            bbox = draw.textbbox((0, 0), word, font=f)
            glyph_w = bbox[2] - bbox[0]
            glyph_h = bbox[3] - bbox[1]

            if is_active:
                # Surligneur : rectangle légèrement débordant, pas arrondi, semi-transparent
                pad_x, pad_y = 6, 4
                draw.rectangle(
                    [x - pad_x, y + bbox[1] - pad_y,
                     x + glyph_w + pad_x, y + bbox[3] + pad_y],
                    fill=(*active_rgb, 200),
                )
                # Texte foncé sur le surligneur
                draw.text((x, y), word, font=f, fill=(15, 15, 15, 255))
            else:
                # Contour + texte blanc pour les mots inactifs
                o = OUTLINE_OFFSET_PX
                for dx, dy in ((0, o), (0, -o), (o, 0), (-o, 0)):
                    draw.text((x + dx, y + dy), word, font=f, fill=(0, 0, 0, 255))
                draw.text((x, y), word, font=f, fill=(255, 255, 255, 255))

            x += _textlength(draw, word + " ", f)

    return np.array(img)


def _render_glow_frame(
    width: int,
    height: int,
    bloc: dict,
    active_word: dict | None,
    style: str,
    font_path: str,
    layout_mode: str = "normal",
) -> np.ndarray:
    """Neon/Glow : lueur colorée simulée par couches de shadow concentriques sur le mot actif."""
    colors = STYLE_COLORS.get(style, STYLE_COLORS["karaoke"])
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    is_split = layout_mode == "split_vertical"
    words_data = bloc["words"]
    lines, font, font_small_obj, line_height = _layout_subtitle_lines(
        words_data, width, font_path, is_split, draw
    )
    safe_bottom = int(height * 0.72)
    n_lines = len(lines)
    y_base = safe_bottom - (line_height * n_lines)
    active_rgb = _hex_to_rgb(colors["active"])

    for line_idx, line_words in enumerate(lines):
        line_width = _line_width_total(draw, line_words, font, font_small_obj)
        x = (width - line_width) / 2
        y = y_base + line_idx * line_height

        for word_obj in line_words:
            word = word_obj["word"]
            is_active = active_word and word == active_word["word"]
            f = _word_font(word, font, font_small_obj)

            if is_active:
                # Glow : cercles concentriques de shadow de plus en plus transparents
                glow_layers = [(10, 30), (7, 55), (5, 90), (3, 130), (2, 180)]
                for offset, alpha in glow_layers:
                    for dx in (-offset, 0, offset):
                        for dy in (-offset, 0, offset):
                            if dx == 0 and dy == 0:
                                continue
                            draw.text((x + dx, y + dy), word, font=f, fill=(*active_rgb, alpha))
                # Texte blanc brillant par-dessus
                draw.text((x + 1, y + 1), word, font=f, fill=(0, 0, 0, 120))
                draw.text((x, y), word, font=f, fill=(255, 255, 255, 255))
            else:
                # Mots inactifs : couleur inactive avec contour fin
                inactive_rgb = _hex_to_rgb(colors["inactive"])
                o = 2
                for dx, dy in ((0, o), (0, -o), (o, 0), (-o, 0)):
                    draw.text((x + dx, y + dy), word, font=f, fill=(0, 0, 0, 200))
                draw.text((x, y), word, font=f, fill=(*inactive_rgb, 180))

            x += _textlength(draw, word + " ", f)

    return np.array(img)


def _render_gradient_frame(
    width: int,
    height: int,
    bloc: dict,
    active_word: dict | None,
    style: str,
    font_path: str,
    layout_mode: str = "normal",
) -> np.ndarray:
    """Gradient/Sunset : mot actif avec effet dégradé (couleur active + reflet clair décalé), inactifs blancs."""
    colors = STYLE_COLORS.get(style, STYLE_COLORS["karaoke"])
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    is_split = layout_mode == "split_vertical"
    words_data = bloc["words"]
    lines, font, font_small_obj, line_height = _layout_subtitle_lines(
        words_data, width, font_path, is_split, draw
    )
    safe_bottom = int(height * 0.72)
    n_lines = len(lines)
    y_base = safe_bottom - (line_height * n_lines)
    active_rgb = _hex_to_rgb(colors["active"])
    # Couleur claire pour simuler la fin du dégradé (reflet)
    light_rgb = (min(255, active_rgb[0] + 90), min(255, active_rgb[1] + 60), min(255, active_rgb[2] + 40))

    for line_idx, line_words in enumerate(lines):
        line_width = _line_width_total(draw, line_words, font, font_small_obj)
        x = (width - line_width) / 2
        y = y_base + line_idx * line_height

        for word_obj in line_words:
            word = word_obj["word"]
            is_active = active_word and word == active_word["word"]
            f = _word_font(word, font, font_small_obj)

            if is_active:
                # Contour noir
                o = OUTLINE_OFFSET_PX
                for dx, dy in ((0, o), (0, -o), (o, 0), (-o, 0)):
                    draw.text((x + dx, y + dy), word, font=f, fill=(0, 0, 0, 255))
                # Couche de base : couleur active
                draw.text((x, y), word, font=f, fill=(*active_rgb, 255))
                # Reflet clair décalé vers le haut-gauche pour simuler un dégradé lumineux
                draw.text((x - 1, y - 2), word, font=f, fill=(*light_rgb, 140))
            else:
                o = OUTLINE_OFFSET_PX
                for dx, dy in ((0, o), (0, -o), (o, 0), (-o, 0)):
                    draw.text((x + dx, y + dy), word, font=f, fill=(0, 0, 0, 255))
                draw.text((x + 2, y + 2), word, font=f, fill=(30, 30, 30, 100))
                draw.text((x, y), word, font=f, fill=(255, 255, 255, 255))

            x += _textlength(draw, word + " ", f)

    return np.array(img)


def _render_minimal_frame(
    width: int,
    height: int,
    bloc: dict,
    active_word: dict | None,
    style: str,
    font_path: str,
    layout_mode: str = "normal",
) -> np.ndarray:
    """Minimal : pas de pilule ni de boîte. Mot actif coloré, inactifs semi-transparents. Contour très fin."""
    colors = STYLE_COLORS.get(style, STYLE_COLORS["karaoke"])
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    is_split = layout_mode == "split_vertical"
    words_data = bloc["words"]
    lines, font, font_small_obj, line_height = _layout_subtitle_lines(
        words_data, width, font_path, is_split, draw
    )
    safe_bottom = int(height * 0.72)
    n_lines = len(lines)
    y_base = safe_bottom - (line_height * n_lines)
    active_rgb = _hex_to_rgb(colors["active"])
    inactive_rgb = _hex_to_rgb(colors["inactive"])
    contour_rgb = _hex_to_rgb(colors["contour"])

    for line_idx, line_words in enumerate(lines):
        line_width = _line_width_total(draw, line_words, font, font_small_obj)
        x = (width - line_width) / 2
        y = y_base + line_idx * line_height

        for word_obj in line_words:
            word = word_obj["word"]
            is_active = active_word and word == active_word["word"]
            f = _word_font(word, font, font_small_obj)

            # Contour fin (1px) pour tous les mots
            for dx, dy in ((0, 1), (0, -1), (1, 0), (-1, 0)):
                draw.text((x + dx, y + dy), word, font=f, fill=(*contour_rgb, 180))

            if is_active:
                draw.text((x, y), word, font=f, fill=(*active_rgb, 255))
            else:
                draw.text((x, y), word, font=f, fill=(*inactive_rgb, 160))

            x += _textlength(draw, word + " ", f)

    return np.array(img)


def render_subtitle_frame(
    width: int,
    height: int,
    bloc: dict,
    active_word: dict | None,
    style: str,
    font_path: str,
    layout_mode: str = "normal",
) -> np.ndarray:
    """Dispatch vers le renderer correspondant au variant du style."""
    variant = STYLE_VARIANTS.get(style, "pill")
    if variant == "impact":
        return _render_impact_frame(width, height, bloc, active_word, style, font_path, layout_mode)
    if variant == "boxed":
        return _render_boxed_frame(width, height, bloc, active_word, style, font_path, layout_mode)
    if variant == "marker":
        return _render_marker_frame(width, height, bloc, active_word, style, font_path, layout_mode)
    if variant == "glow":
        return _render_glow_frame(width, height, bloc, active_word, style, font_path, layout_mode)
    if variant == "gradient":
        return _render_gradient_frame(width, height, bloc, active_word, style, font_path, layout_mode)
    if variant == "minimal":
        return _render_minimal_frame(width, height, bloc, active_word, style, font_path, layout_mode)

    colors = STYLE_COLORS.get(style, STYLE_COLORS["karaoke"])
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    is_split = layout_mode == "split_vertical"
    words_data = bloc["words"]

    lines, font, font_small_obj, line_height = _layout_subtitle_lines(
        words_data, width, font_path, is_split, draw
    )

    safe_bottom = int(height * 0.72)
    n_lines = len(lines)
    y_base = safe_bottom - (line_height * n_lines)

    for line_idx, line_words in enumerate(lines):
        line_width = _line_width_total(draw, line_words, font, font_small_obj)
        x = (width - line_width) / 2
        y = y_base + line_idx * line_height

        for word_obj in line_words:
            word = word_obj["word"]
            is_active = active_word and word == active_word["word"]
            couleur_texte = "#FFFFFF" if is_active else colors["inactive"]
            couleur_contour = colors["contour"]

            f = font_small_obj if len(word) > 10 else font

            if is_active:
                hw_pad_x, hw_pad_y, hw_radius = 8, 6, 8
                active_rgb = tuple(int(colors["active"][i:i+2], 16) for i in (1, 3, 5))
                bbox = draw.textbbox((0, 0), word, font=f)
                glyph_w = bbox[2] - bbox[0]
                draw.rounded_rectangle(
                    [x - hw_pad_x, y + bbox[1] - hw_pad_y,
                     x + glyph_w + hw_pad_x, y + bbox[3] + hw_pad_y],
                    radius=hw_radius,
                    fill=(*active_rgb, 255),
                )

            # Ombre grise légère (effet 3D)
            draw.text((x + 2, y + 2), word, font=f, fill=(51, 51, 51, 140))

            # Contour : haut / bas / gauche / droite, 3 px
            o = OUTLINE_OFFSET_PX
            for dx, dy in ((0, o), (0, -o), (o, 0), (-o, 0)):
                draw.text((x + dx, y + dy), word, font=f, fill=couleur_contour)

            draw.text((x, y), word, font=f, fill=couleur_texte)

            x += _textlength(draw, word + " ", f)

    return np.array(img)


def blend_overlay(frame_bgr: np.ndarray, overlay_rgba: np.ndarray) -> np.ndarray:
    """Fusionne l'overlay RGBA sur la frame BGR."""
    overlay_rgb = overlay_rgba[:, :, :3]
    alpha = overlay_rgba[:, :, 3:4] / 255.0
    frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    blended = (alpha * overlay_rgb + (1 - alpha) * frame_rgb).astype(np.uint8)
    return cv2.cvtColor(blended, cv2.COLOR_RGB2BGR)


# Détecteurs de visages pour crop intelligent (chargés une seule fois)
_FRONTAL_CASCADE = None
_PROFILE_CASCADE = None


def _get_frontal_cascade():
    global _FRONTAL_CASCADE
    if _FRONTAL_CASCADE is None:
        path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        _FRONTAL_CASCADE = cv2.CascadeClassifier(path)
    return _FRONTAL_CASCADE


def _get_profile_cascade():
    global _PROFILE_CASCADE
    if _PROFILE_CASCADE is None:
        path = cv2.data.haarcascades + "haarcascade_profileface.xml"
        c = cv2.CascadeClassifier(path)
        _PROFILE_CASCADE = c if not c.empty() else False  # False = fichier absent
    return _PROFILE_CASCADE if _PROFILE_CASCADE is not False else None


def _detect_with_cascade(cascade, gray, frame_w, frame_h):
    faces = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(60, 60))
    if len(faces) == 0:
        return None
    x, y, w, h = max(faces, key=lambda r: r[2] * r[3])
    cx = (x + w / 2) / frame_w
    cy = (y + h / 2) / frame_h
    return (cx, cy)


def detect_face_center(frame: np.ndarray) -> tuple[float, float] | None:
    """
    Détecte le centre du visage principal.
    Essaie MediaPipe d'abord (plus fiable), puis Haar cascade en fallback.
    """
    # 1. MediaPipe (meilleure détection, marche de profil/biais/mouvement)
    try:
        faces = detect_all_faces_mp(frame, min_area_ratio=0.35, min_absolute_area=0.003)
        if faces:
            # Visage le plus grand = sujet principal
            cx, cy, _ = max(faces, key=lambda f: f[2])
            return (cx, cy)
    except Exception:
        pass

    # 2. Haar cascade frontal
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    h, w = frame.shape[:2]
    pos = _detect_with_cascade(_get_frontal_cascade(), gray, w, h)
    if pos is not None:
        return pos

    # 3. Profil gauche
    profile = _get_profile_cascade()
    if profile is not None:
        pos = _detect_with_cascade(profile, gray, w, h)
        if pos is not None:
            return pos

        # 4. Profil droit
        flipped = cv2.flip(gray, 1)
        pos = _detect_with_cascade(profile, flipped, w, h)
        if pos is not None:
            return (1.0 - pos[0], pos[1])

    return None


_DETECT_INTERVAL: int = int(os.environ.get("SMART_CROP_DETECT_INTERVAL", "15"))
_SMART_CROP_MAX_WIDTH: int = int(os.environ.get("SMART_CROP_MAX_WIDTH", "0")) or 0
_SCENE_CUT_THRESHOLD: float = 0.25
_PROGRESS_LOG_FRAMES = 200
_DEFAULT_CX: float = 0.5
_DEFAULT_CY: float = 0.4
_CY_CLAMP = (0.25, 0.42)


def _downscale_for_detection(frame: np.ndarray) -> np.ndarray:
    """Downscale frame to _SMART_CROP_MAX_WIDTH for faster face detection.
    Returns the original frame if max_width is 0 or frame is already small enough."""
    if _SMART_CROP_MAX_WIDTH <= 0:
        return frame
    h, w = frame.shape[:2]
    if w <= _SMART_CROP_MAX_WIDTH:
        return frame
    scale = _SMART_CROP_MAX_WIDTH / w
    new_w = _SMART_CROP_MAX_WIDTH
    new_h = int(h * scale)
    return cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_AREA)


def _detect_raw_center(
    frame: np.ndarray,
    prev_frame: np.ndarray | None = None,
    scene_cut_threshold: float = _SCENE_CUT_THRESHOLD,
) -> tuple[float | None, float | None, bool]:
    """
    Pure detection: returns (cx, cy, is_scene_cut).
    cx/cy are None when no face is found.
    """
    is_scene_cut = False
    if prev_frame is not None:
        diff = np.mean(np.abs(frame.astype(float) - prev_frame.astype(float))) / 255.0
        if diff > scene_cut_threshold:
            is_scene_cut = True

    pos = detect_face_center(frame)
    if pos is not None:
        return (float(pos[0]), float(pos[1]), is_scene_cut)
    return (None, None, is_scene_cut)


def _drain_subprocess_stderr(proc: subprocess.Popen, chunks: list) -> None:
    """Lit stderr en continu pour éviter que le buffer PIPE ne bloque ffmpeg (deadlock)."""
    if not proc.stderr:
        return
    try:
        while True:
            block = proc.stderr.read(65536)
            if not block:
                break
            chunks.append(block)
    except Exception:
        pass


def collect_crop_positions(
    cap: cv2.VideoCapture,
    start_pts: int,
    clip_frames: int,
    fps: float,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Pass 1: read all frames, detect faces every _DETECT_INTERVAL frames,
    interpolate gaps, smooth per scene-cut segment with gaussian_filter1d.
    Rewinds cap to start_pts before returning.
    """
    cap.set(cv2.CAP_PROP_POS_FRAMES, start_pts)

    print(
        f"[SMARTCROP] collect pass 1 — {clip_frames} frames (~{clip_frames / max(fps, 1):.1f}s @ {fps:.2f}fps) "
        f"detect_interval={_DETECT_INTERVAL} max_width={_SMART_CROP_MAX_WIDTH or 'source'}",
        flush=True,
    )

    cx_raw = np.full(clip_frames, np.nan, dtype=np.float32)
    cy_raw = np.full(clip_frames, np.nan, dtype=np.float32)
    scene_cuts: list[int] = []
    prev_frame: np.ndarray | None = None
    last_known: tuple[float, float] | None = None

    for i in range(clip_frames):
        ret, frame = cap.read()
        if not ret:
            break

        is_cut = False
        if prev_frame is not None:
            diff = np.mean(np.abs(frame.astype(float) - prev_frame.astype(float))) / 255.0
            if diff > _SCENE_CUT_THRESHOLD:
                is_cut = True
                scene_cuts.append(i)
                last_known = None

        if is_cut or i % _DETECT_INTERVAL == 0:
            small = _downscale_for_detection(frame)
            pos = detect_face_center(small)
            if pos is not None:
                if last_known is not None and abs(pos[0] - last_known[0]) > 0.30:
                    # Saut trop grand — ignorer mais conserver last_known comme ancre
                    cx_raw[i] = last_known[0]
                    cy_raw[i] = last_known[1]
                else:
                    cx_raw[i] = pos[0]
                    cy_raw[i] = pos[1]
                    last_known = (pos[0], pos[1])
            elif last_known is not None:
                # Aucun visage détecté — ancrer sur la dernière position connue
                # (évite le drift par interpolation linéaire vers la prochaine détection)
                cx_raw[i] = last_known[0]
                cy_raw[i] = last_known[1]

        prev_frame = frame

        if i > 0 and i % _PROGRESS_LOG_FRAMES == 0:
            print(f"[SMARTCROP] collect {i}/{clip_frames} frames...", flush=True)

    # Build segment boundaries: [0, cut1, cut2, ..., clip_frames]
    boundaries = [0] + scene_cuts + [clip_frames]

    cx_smooth = np.empty(clip_frames, dtype=np.float32)
    cy_smooth = np.empty(clip_frames, dtype=np.float32)

    for seg_idx in range(len(boundaries) - 1):
        s = boundaries[seg_idx]
        e = boundaries[seg_idx + 1]
        seg_cx = cx_raw[s:e].copy()
        seg_cy = cy_raw[s:e].copy()

        detected = np.where(~np.isnan(seg_cx))[0]
        if len(detected) == 0:
            seg_cx[:] = _DEFAULT_CX
            seg_cy[:] = _DEFAULT_CY
        else:
            all_idx = np.arange(len(seg_cx))
            seg_cx = np.interp(all_idx, detected, seg_cx[detected]).astype(np.float32)
            seg_cy = np.interp(all_idx, detected, seg_cy[detected]).astype(np.float32)

        if len(seg_cx) > 1:
            seg_cx = gaussian_filter1d(seg_cx, sigma=22, mode="nearest")
            seg_cy = gaussian_filter1d(seg_cy, sigma=8, mode="nearest")

        np.clip(seg_cy, _CY_CLAMP[0], _CY_CLAMP[1], out=seg_cy)

        cx_smooth[s:e] = seg_cx
        cy_smooth[s:e] = seg_cy

    print(
        f"[SMARTCROP] collect done: {clip_frames} frames, {len(scene_cuts)} cuts, "
        f"cx range [{cx_smooth.min():.2f}, {cx_smooth.max():.2f}]",
        flush=True,
    )

    cap.set(cv2.CAP_PROP_POS_FRAMES, start_pts)
    return cx_smooth, cy_smooth


# ---------------------------------------------------------------------------
# MediaPipe face detection for multi-face analysis (split vertical feature)
# ---------------------------------------------------------------------------

_MP_FACE_DETECTOR = None
_MP_MODEL_PATH = str(Path(__file__).parent / "models" / "blaze_face_short_range.tflite")


def _get_mp_face_detector():
    global _MP_FACE_DETECTOR
    if _MP_FACE_DETECTOR is None:
        base_options = mp.tasks.BaseOptions(model_asset_path=_MP_MODEL_PATH)
        options = mp.tasks.vision.FaceDetectorOptions(
            base_options=base_options,
            min_detection_confidence=0.7,
            min_suppression_threshold=0.3,
        )
        _MP_FACE_DETECTOR = mp.tasks.vision.FaceDetector.create_from_options(options)
    return _MP_FACE_DETECTOR


def detect_all_faces_mp(
    frame: np.ndarray,
    min_area_ratio: float = 0.35,
    min_horizontal_distance: float = 0.25,
    min_absolute_area: float = 0.005,
) -> list[tuple[float, float, float]]:
    """
    Detect all faces in *frame* using MediaPipe.

    Returns a list of (cx, cy, area_ratio) normalised 0-1.
    Filters applied:
      - MediaPipe confidence >= 0.7 (set at detector level)
      - absolute area filter: discard faces smaller than *min_absolute_area*
      - relative area filter: discard faces < *min_area_ratio* of the largest
      - proximity filter: if two centroids are closer than
        *min_horizontal_distance* (normalised), keep only the largest
    """
    detector = _get_mp_face_detector()
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    result = detector.detect(mp_image)

    if not result.detections:
        return []

    h_frame, w_frame = frame.shape[:2]
    raw: list[tuple[float, float, float]] = []
    for det in result.detections:
        bb = det.bounding_box
        cx = (bb.origin_x + bb.width / 2.0) / w_frame
        cy = (bb.origin_y + bb.height / 2.0) / h_frame
        area = (bb.width / w_frame) * (bb.height / h_frame)
        raw.append((float(cx), float(cy), float(area)))

    if not raw:
        return []

    max_area = max(r[2] for r in raw)
    filtered = [r for r in raw if r[2] >= min_area_ratio * max_area and r[2] >= min_absolute_area]

    filtered.sort(key=lambda r: -r[2])
    kept: list[tuple[float, float, float]] = []
    for face in filtered:
        too_close = False
        for existing in kept:
            if abs(face[0] - existing[0]) < min_horizontal_distance:
                too_close = True
                break
        if not too_close:
            kept.append(face)

    return kept


def analyze_face_count_for_clip(
    video_path: str,
    start: float,
    end: float,
    sample_interval: float = 2.0,
    multi_face_threshold: float = 0.70,
) -> dict:
    """
    Sample frames from [start, end] and count how many show >= 2 distinct faces.

    Returns:
        {
            "face_count_mode": 1 | 2,
            "confidence": float,       # proportion of sampled frames with 2+ faces
            "total_sampled": int,
            "multi_face_frames": int,
            "median_positions": [       # median (cx, cy) of each tracked cluster
                {"cx": float, "cy": float}, ...
            ]
        }
    """
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    duration = end - start
    num_samples = max(1, int(duration / sample_interval))

    multi_face_count = 0
    all_positions: list[list[tuple[float, float]]] = []

    for i in range(num_samples):
        t = start + (i + 0.5) * (duration / num_samples)
        frame_idx = int(t * fps)
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ret, frame = cap.read()
        if not ret:
            continue

        faces = detect_all_faces_mp(frame)
        if len(faces) >= 2:
            multi_face_count += 1
            all_positions.append([(f[0], f[1]) for f in faces[:2]])

    cap.release()

    confidence = multi_face_count / num_samples if num_samples > 0 else 0.0
    face_count_mode = 2 if confidence >= multi_face_threshold else 1

    median_positions: list[dict[str, float]] = []
    if all_positions:
        for slot in range(min(2, min(len(p) for p in all_positions))):
            xs = sorted(p[slot][0] for p in all_positions)
            ys = sorted(p[slot][1] for p in all_positions)
            median_positions.append({
                "cx": xs[len(xs) // 2],
                "cy": ys[len(ys) // 2],
            })

    return {
        "face_count_mode": face_count_mode,
        "confidence": round(confidence, 3),
        "total_sampled": num_samples,
        "multi_face_frames": multi_face_count,
        "median_positions": median_positions,
    }


def get_crop_center_for_frame(
    frame: np.ndarray,
    prev_center: tuple[float, float] | None = None,
    frame_idx: int = 0,
    smoothing: float = 0.85,
    prev_frame: np.ndarray | None = None,
    scene_cut_threshold: float = 0.25,
) -> tuple[float, float]:
    """
    Thin wrapper kept for backward compatibility.
    Returns raw detection result (no smoothing — smoothing is now done
    globally in collect_crop_positions).
    """
    cx, cy, _ = _detect_raw_center(frame, prev_frame, scene_cut_threshold)
    if cx is None:
        return (_DEFAULT_CX, _DEFAULT_CY)
    return (cx, max(_CY_CLAMP[0], min(cy, _CY_CLAMP[1])))


def resize_and_crop_frame(
    frame: np.ndarray,
    out_w: int,
    out_h: int,
    crop_center: tuple[float, float] | None,
) -> np.ndarray:
    """
    Redimensionne et crop la frame pour remplir out_w x out_h.
    crop_center: (x, y) normalisés 0-1, fixe pour tout le clip. None = centre.
    """
    src_h, src_w = frame.shape[:2]
    ar_src = src_w / src_h
    ar_out = out_w / out_h

    if ar_src > ar_out:
        scale = out_h / src_h
    else:
        scale = out_w / src_w

    new_w = int(src_w * scale)
    new_h = int(src_h * scale)
    scaled = cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_LANCZOS4)

    if crop_center is not None:
        cx, cy = crop_center
        center_x = int(cx * new_w)
        center_y = int(cy * new_h)
    else:
        center_x = new_w // 2
        center_y = new_h // 2

    # Bornes du crop
    x1 = max(0, center_x - out_w // 2)
    x2 = min(new_w, x1 + out_w)
    x1 = max(0, x2 - out_w)
    y1 = max(0, center_y - out_h // 2)
    y2 = min(new_h, y1 + out_h)
    y1 = max(0, y2 - out_h)

    cropped = scaled[y1:y2, x1:x2]
    if cropped.shape[0] != out_h or cropped.shape[1] != out_w:
        cropped = cv2.resize(cropped, (out_w, out_h), interpolation=cv2.INTER_LANCZOS4)
    return cropped


def resize_and_crop_split_frame(
    frame: np.ndarray,
    center_top: tuple[float, float],
    center_bottom: tuple[float, float],
    half_h: int = 960,
    out_w: int = 1080,
    separator_px: int = 0,
) -> np.ndarray:
    """
    Produit un frame split vertical : 2 crops 1080x960 empilés.
    center_top, center_bottom : (cx, cy) normalisés 0-1 pour chaque zone.
    """
    src_h, src_w = frame.shape[:2]
    scale = max(out_w / src_w, half_h / (src_h / 2))
    new_w = int(src_w * scale)
    new_h = int(src_h * scale)

    scaled = cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_LANCZOS4)

    def crop_at_center(cx: float, cy: float) -> np.ndarray:
        center_x = int(cx * new_w)
        center_y = int(cy * new_h)
        y1 = max(0, center_y - half_h // 2)
        y2 = min(new_h, y1 + half_h)
        y1 = max(0, y2 - half_h)
        x1 = max(0, center_x - out_w // 2)
        x2 = min(new_w, x1 + out_w)
        x1 = max(0, x2 - out_w)
        crop = scaled[y1:y2, x1:x2]
        if crop.shape[0] != half_h or crop.shape[1] != out_w:
            crop = cv2.resize(crop, (out_w, half_h), interpolation=cv2.INTER_LANCZOS4)
        return crop

    top_crop = crop_at_center(center_top[0], center_top[1])
    bottom_crop = crop_at_center(center_bottom[0], center_bottom[1])

    if separator_px > 0:
        sep = np.full((separator_px, out_w, 3), (60, 60, 60), dtype=np.uint8)
        return np.vstack([top_crop, sep, bottom_crop])
    return np.vstack([top_crop, bottom_crop])


def get_split_centers_for_frame(
    frame: np.ndarray,
    prev_top: tuple[float, float] | None,
    prev_bottom: tuple[float, float] | None,
    init_positions: list[dict],
    frame_idx: int,
    smoothing: float = 0.85,
) -> tuple[tuple[float, float], tuple[float, float]]:
    """
    Retourne (center_top, center_bottom) pour cette frame.
    Utilise detect_all_faces_mp + nearest-neighbor pour associer aux 2 slots.
    """
    fallback_top = (init_positions[0]["cx"], init_positions[0]["cy"]) if len(init_positions) > 0 else (0.33, 0.4)
    fallback_bottom = (init_positions[1]["cx"], init_positions[1]["cy"]) if len(init_positions) > 1 else (0.67, 0.4)

    target_top = prev_top if prev_top else fallback_top
    target_bottom = prev_bottom if prev_bottom else fallback_bottom

    if frame_idx % 10 == 0:
        faces = detect_all_faces_mp(frame)
        if len(faces) >= 2:
            f0, f1 = faces[0], faces[1]
            d0_top = (f0[0] - target_top[0]) ** 2 + (f0[1] - target_top[1]) ** 2
            d0_bot = (f0[0] - target_bottom[0]) ** 2 + (f0[1] - target_bottom[1]) ** 2
            d1_top = (f1[0] - target_top[0]) ** 2 + (f1[1] - target_top[1]) ** 2
            d1_bot = (f1[0] - target_bottom[0]) ** 2 + (f1[1] - target_bottom[1]) ** 2
            if d0_top + d1_bot <= d0_bot + d1_top:
                target_top = (f0[0], f0[1])
                target_bottom = (f1[0], f1[1])
            else:
                target_top = (f1[0], f1[1])
                target_bottom = (f0[0], f0[1])

    if prev_top and prev_bottom:
        new_top = (smoothing * prev_top[0] + (1 - smoothing) * target_top[0], smoothing * prev_top[1] + (1 - smoothing) * target_top[1])
        new_bottom = (smoothing * prev_bottom[0] + (1 - smoothing) * target_bottom[0], smoothing * prev_bottom[1] + (1 - smoothing) * target_bottom[1])
        return (new_top, new_bottom)
    return (target_top, target_bottom)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("video_path", help="Chemin vidéo source")
    parser.add_argument("start", type=float, help="Début du clip (s)")
    parser.add_argument("end", type=float, help="Fin du clip (s)")
    parser.add_argument("output_path", nargs="?", default=None, help="Chemin sortie MP4")
    parser.add_argument("transcription_path", nargs="?", default=None, help="JSON transcription")
    parser.add_argument(
        "--style",
        default="karaoke",
        choices=[
            "karaoke",
            "impact",
            "highlight",
            "minimal",
            "neon",
            "boxed",
            "ocean",
            "sunset",
            "slate",
            "berry",
        ],
    )
    parser.add_argument("--format", default="9:16", choices=["9:16", "1:1"])
    parser.add_argument("--font", help="Chemin police TTF")
    parser.add_argument("--smart-crop", action="store_true", help="Crop intelligent centré sur le visage (format vertical)")
    parser.add_argument(
        "--proxy-path",
        type=str,
        default=None,
        help="Chemin vers le proxy 640p pour la pass 1 smart-crop",
    )
    parser.add_argument("--analyze-faces", action="store_true", help="Analyse multi-visages uniquement (JSON stdout, pas de rendu)")
    parser.add_argument("--split-vertical", action="store_true", help="Rendu split vertical (2 cadrans haut/bas)")
    parser.add_argument("--face-positions", help="JSON des positions des 2 visages pour split vertical")
    args = parser.parse_args()

    if args.analyze_faces:
        result = analyze_face_count_for_clip(args.video_path, args.start, args.end)
        print(json.dumps(result, indent=2))
        sys.exit(0)

    if not args.output_path or not args.transcription_path:
        parser.error("output_path et transcription_path sont requis pour le rendu")

    use_split = args.split_vertical and args.face_positions and os.path.exists(args.face_positions)
    face_positions: list[dict] = []
    if use_split:
        with open(args.face_positions, "r", encoding="utf-8") as f:
            face_positions = json.load(f)
        if not isinstance(face_positions, list) or len(face_positions) < 2:
            use_split = False
            face_positions = []

    out_w, out_h = (1080, 1080) if args.format == "1:1" else (1080, 1920)

    script_dir = Path(__file__).parent
    font_path = args.font or str(script_dir / "fonts" / "Montserrat-Black.ttf")
    if not os.path.exists(font_path):
        font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
    if not os.path.exists(font_path):
        font_path = "/System/Library/Fonts/Helvetica.ttc"

    with open(args.transcription_path, "r", encoding="utf-8") as f:
        transcription = json.load(f)

    words = get_words_in_range(transcription, args.start, args.end)
    if not words:
        blocks = []
    else:
        # Impact : 3 mots par bloc, durée minimale 0.5s pour éviter le clignotement
        if args.style == "impact":
            blocks = group_into_blocks(words, max_per_block=3, min_block_duration=0.5)
        else:
            blocks = group_into_blocks(words, max_per_block=4)

    cap = cv2.VideoCapture(args.video_path)
    fps_src = float(cap.get(cv2.CAP_PROP_FPS) or 30)
    src_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    src_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    clip_duration = args.end - args.start
    clip_frames_full = int(clip_duration * fps_src)

    # Sous-échantillonner le FPS de sortie (ex. 60→30) : ~2× moins de frames Pillow + pipe.
    # Le split vertical reste en plein débit (indices de visages alignés sur la source).
    # Défaut 30 fps si non défini ; `full` / `0` / `off` = même FPS que la source.
    stride = 1
    max_out_env = os.environ.get("RENDER_MAX_OUTPUT_FPS", "30").strip()
    if max_out_env.lower() in ("full", "source", "off", "0", "false"):
        max_out_env = ""
    if not use_split and max_out_env:
        try:
            target = float(max_out_env)
            if target > 0 and target < fps_src - 0.01:
                stride = max(1, int(round(fps_src / target)))
        except ValueError:
            pass
    out_fps = fps_src / stride
    clip_frames_out = int(clip_duration * out_fps)

    x264_preset = os.environ.get("RENDER_LIBX264_PRESET", "veryfast").strip() or "veryfast"
    x264_threads = os.environ.get("RENDER_LIBX264_THREADS", "0").strip() or "0"
    x264_crf = os.environ.get("RENDER_LIBX264_CRF", "20").strip() or "20"

    ffmpeg_cmd = [
        "ffmpeg", "-y",
        "-f", "rawvideo",
        "-vcodec", "rawvideo",
        "-s", f"{out_w}x{out_h}",
        "-pix_fmt", "bgr24",
        "-r", f"{out_fps:.6f}".rstrip("0").rstrip("."),
        "-i", "pipe:0",
        "-ss", str(args.start),
        "-t", str(clip_duration),
        "-i", args.video_path,
        "-map", "0:v",
        "-map", "1:a:0?",  # first audio stream only — skip unsupported codecs (e.g. Apple Spatial Audio / apac)
        "-c:v", "libx264",
        "-preset", x264_preset,
        "-crf", x264_crf,
        "-pix_fmt", "yuv420p",
        "-threads", x264_threads,
        "-c:a", "aac",
        "-b:a", "192k",
        "-movflags", "+faststart",
        args.output_path,
    ]

    print("FFMPEG_CMD:", " ".join(ffmpeg_cmd), flush=True)
    if stride > 1:
        print(
            f"[RENDER] stride={stride} fps {fps_src:.3f}→{out_fps:.3f} "
            f"frames {clip_frames_out} (collect {clip_frames_full})",
            flush=True,
        )

    start_pts = int(args.start * fps_src)
    use_smart_crop = args.smart_crop and args.format == "9:16" and not use_split

    _smartcrop_path = (
        args.proxy_path
        if (args.proxy_path and os.path.exists(args.proxy_path))
        else None
    )

    cx_smooth: np.ndarray | None = None
    cy_smooth: np.ndarray | None = None
    t_pass1_start = time.monotonic()
    if use_smart_crop:
        print(
            f"[SMARTCROP] source={'proxy' if _smartcrop_path else 'original'} → "
            f"{_smartcrop_path or args.video_path}",
            flush=True,
        )
        if _smartcrop_path:
            cap_sc = cv2.VideoCapture(_smartcrop_path)
            cx_smooth, cy_smooth = collect_crop_positions(
                cap_sc, start_pts, clip_frames_full, fps_src
            )
            cap_sc.release()
            cap.set(cv2.CAP_PROP_POS_FRAMES, start_pts)
        else:
            cx_smooth, cy_smooth = collect_crop_positions(
                cap, start_pts, clip_frames_full, fps_src
            )
    else:
        cap.set(cv2.CAP_PROP_POS_FRAMES, start_pts)
    t_pass1_end = time.monotonic()
    print(
        f"[TIMING] pass1 (smart-crop collect) {t_pass1_end - t_pass1_start:.1f}s "
        f"(smart_crop={'ON' if use_smart_crop else 'OFF'})",
        flush=True,
    )

    print(
        f"[RENDER] pass 2 — {clip_frames_out} frames @ {out_fps:.2f}fps (subtitles + pipe → ffmpeg)",
        flush=True,
    )

    t_pass2_start = time.monotonic()
    proc = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)

    stderr_chunks: list[bytes] = []
    stderr_thread = threading.Thread(
        target=_drain_subprocess_stderr,
        args=(proc, stderr_chunks),
        daemon=True,
    )
    stderr_thread.start()

    prev_split_top: tuple[float, float] | None = None
    prev_split_bottom: tuple[float, float] | None = None

    for i in range(clip_frames_out):
        if stride > 1 and i > 0:
            for _ in range(stride - 1):
                cap.read()
        ret, frame = cap.read()
        if not ret:
            break

        src_idx = min(i * stride, clip_frames_full - 1) if clip_frames_full > 0 else i
        t = i / out_fps
        if use_split:
            center_top, center_bottom = get_split_centers_for_frame(
                frame, prev_split_top, prev_split_bottom, face_positions, i, smoothing=0.85
            )
            prev_split_top, prev_split_bottom = center_top, center_bottom
            frame = resize_and_crop_split_frame(frame, center_top, center_bottom, half_h=960, out_w=1080)
        elif use_smart_crop:
            crop_center = (float(cx_smooth[src_idx]), float(cy_smooth[src_idx]))
            frame = resize_and_crop_frame(frame, out_w, out_h, crop_center)
        else:
            frame = resize_and_crop_frame(frame, out_w, out_h, None)

        bloc = get_bloc_at_with_silence_gate(t, blocks)
        active_word = get_word_at(t, bloc) if bloc else None

        if bloc and (active_word or bloc["words"]):
            overlay = render_subtitle_frame(
                out_w, out_h, bloc, active_word, args.style, font_path,
                layout_mode="split_vertical" if use_split else "normal",
            )
            frame = blend_overlay(frame, overlay)

        try:
            proc.stdin.write(np.ascontiguousarray(frame).tobytes())
        except BrokenPipeError:
            stderr_thread.join(timeout=30)
            stderr_out = b"".join(stderr_chunks).decode("utf-8", errors="replace")
            print(
                "FFMPEG_STDERR (broken pipe, derniers octets):",
                stderr_out[-8000:],
                flush=True,
            )
            raise

        if i > 0 and i % _PROGRESS_LOG_FRAMES == 0:
            print(f"[RENDER] frames {i}/{clip_frames_out}...", flush=True)

    proc.stdin.close()
    proc.wait()
    stderr_thread.join(timeout=120)
    cap.release()
    t_pass2_end = time.monotonic()

    pass1_s = t_pass1_end - t_pass1_start
    pass2_s = t_pass2_end - t_pass2_start
    total_s = t_pass2_end - t_pass1_start
    print(
        f"[TIMING] pass2 (render+ffmpeg) {pass2_s:.1f}s | "
        f"total {total_s:.1f}s (pass1={pass1_s:.1f}s + pass2={pass2_s:.1f}s)",
        flush=True,
    )

    stderr_out = b"".join(stderr_chunks).decode("utf-8", errors="replace")
    print("FFMPEG_STDERR:", stderr_out[-3000:], flush=True)

    if proc.returncode != 0:
        print("FFMPEG_EXIT_CODE:", proc.returncode, flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
