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

# Styles actifs (picker) + alias legacy (recolors retirés du UI, encore rendus si un vieux job les a).
# Aligné avec src/lib/subtitle-style-colors.ts pour les 6 styles publics.
STYLE_COLORS = {
    "impact":    {"active": "#BEFF00", "inactive": "#FFFFFF", "contour": "#000000"},
    "karaoke":   {"active": "#22C55E", "inactive": "#FFFFFF", "contour": "#000000"},
    "highlight": {"active": "#F43F5E", "inactive": "#FFFFFF", "contour": "#000000"},
    "neon":      {"active": "#D946EF", "inactive": "#F5F3FF", "contour": "#000000"},
    "boxed":     {"active": "#6D28D9", "inactive": "#FFFFFF", "contour": "#000000"},
    "minimal":   {"active": "#A78BFA", "inactive": "#E8E4F0", "contour": "#000000"},
    # Legacy aliases (anciens jobs)
    "ocean":     {"active": "#0891B2", "inactive": "#E0F2FE", "contour": "#000000"},
    "sunset":    {"active": "#EA580C", "inactive": "#FFF7ED", "contour": "#000000"},
    "slate":     {"active": "#475569", "inactive": "#CBD5E1", "contour": "#0F172A"},
    "berry":     {"active": "#BE123C", "inactive": "#FCE7F3", "contour": "#000000"},
}


def filter_emojis(text: str) -> str:
    return EMOJI_REGEX.sub("", text).strip() or " "


def _norm_token(s: str) -> str:
    """Forme canonique pour comparer un token du texte avec les mots Whisper."""
    return "".join(ch for ch in s.casefold() if ch.isalnum())


def _display_token(s: str) -> str:
    """Nettoie un token du texte pour l'affichage : retire la ponctuation en bordure
    (virgules, points, guillemets…) mais garde apostrophes/traits d'union internes."""
    start, end = 0, len(s)
    while start < end and not s[start].isalnum():
        start += 1
    while end > start and not s[end - 1].isalnum():
        end -= 1
    return s[start:end]


def restore_punctuated_words(raw_words: list, full_text: str) -> list:
    """
    Le tableau `words` de whisper-1 supprime toute la ponctuation, apostrophes
    comprises : "c'est" devient deux mots "c" + "est". Le texte des segments, lui,
    est correctement ponctué. On réaligne les deux pour reconstruire les mots
    affichables ("C'est", "aujourd'hui") avec les timings des mots Whisper.
    """
    tokens = full_text.split()
    result = []
    wi = 0
    for tok in tokens:
        tok_norm = _norm_token(tok)
        if not tok_norm:
            continue  # token purement ponctuation ("—", "...")
        if wi >= len(raw_words):
            break
        # Consomme 1..n mots Whisper dont la concaténation normalisée == token
        acc = ""
        j = wi
        matched = False
        while j < len(raw_words) and j - wi < 8:
            acc += _norm_token(str(raw_words[j].get("word", "")))
            j += 1
            if acc == tok_norm:
                matched = True
                break
            if len(acc) >= len(tok_norm):
                break
        if matched:
            disp = _display_token(tok)
            if disp:
                result.append({
                    "word": disp,
                    "start": raw_words[wi].get("start", 0),
                    "end": raw_words[j - 1].get("end", 0),
                })
            wi = j
        else:
            # Désynchronisation locale : émettre le mot Whisper brut et resynchroniser
            # sur le token suivant plutôt que de perdre des mots.
            w = raw_words[wi]
            result.append({
                "word": str(w.get("word", "")),
                "start": w.get("start", 0),
                "end": w.get("end", 0),
            })
            wi += 1
    while wi < len(raw_words):
        w = raw_words[wi]
        result.append({
            "word": str(w.get("word", "")),
            "start": w.get("start", 0),
            "end": w.get("end", 0),
        })
        wi += 1
    return result


def get_words_in_range(transcription: dict, clip_start: float, clip_end: float) -> list:
    """Extrait les mots dans l'intervalle du clip."""
    words = []
    raw_words = transcription.get("words")
    if not raw_words and transcription.get("segments"):
        raw_words = []
        for seg in transcription["segments"]:
            raw_words.extend(seg.get("words") or [])
    if raw_words:
        # whisper-1 supprime apostrophes/ponctuation dans `words` — on les restaure
        # depuis le texte ponctué (text global ou segments).
        full_text = str(transcription.get("text") or "").strip()
        if not full_text and transcription.get("segments"):
            full_text = " ".join(
                str(seg.get("text", "")).strip() for seg in transcription["segments"]
            ).strip()
        if full_text:
            raw_words = restore_punctuated_words(raw_words, full_text)
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
    # Merge apostrophes: Whisper coupe parfois les contractions ("j'ai" -> "j'" + "ai",
    # ou "j" + "'ai"), et utilise indifféremment l'apostrophe droite (') ou courbe (').
    # Sans ce merge, l'apostrophe finit affichée seule, séparée par l'espace inter-mots
    # (ex. "C 'EST" au lieu de "C'EST").
    APOSTROPHES = ("'", "’")
    i = len(words) - 1
    while i >= 0:
        if i + 1 < len(words) and (
            words[i]["word"].endswith(APOSTROPHES)
            or words[i + 1]["word"].startswith(APOSTROPHES)
        ):
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
    if last_before is not None:
        # Après le dernier bloc : ne pas laisser le sous-titre collé jusqu'à la fin
        # du clip s'il reste du silence — même règle de seuil que les gaps internes.
        if t - last_before["bloc_end"] <= silence_threshold:
            return last_before
        return None
    # Avant le premier bloc : jamais d'anticipation — le texte n'apparaît pas
    # avant que la parole ait commencé.
    return None


def compute_voice_activity(video_path: str, start: float, duration: float, hop: float = 0.05):
    """
    Détecte l'activité vocale du clip via l'énergie RMS de l'audio (fenêtres de `hop` s).
    Retourne (voiced: np.ndarray[bool], hop) ou None si l'audio est indisponible.
    Sert à recaler les blocs de sous-titres sur le son réel — les timestamps Whisper
    sont parfois en avance/en retard de plusieurs centaines de ms.
    """
    sr = 16000
    cmd = [
        "ffmpeg", "-v", "error",
        "-ss", str(start), "-t", str(duration),
        "-i", video_path,
        "-vn", "-ac", "1", "-ar", str(sr),
        "-f", "f32le", "pipe:1",
    ]
    try:
        raw = subprocess.run(cmd, capture_output=True, timeout=120).stdout
    except Exception:
        return None
    audio = np.frombuffer(raw, dtype=np.float32)
    win = int(sr * hop)
    if audio.size < win * 4:
        return None
    n = audio.size // win
    rms = np.sqrt(np.mean(audio[: n * win].reshape(n, win) ** 2, axis=1))
    # Seuil adaptatif conservateur : on ne déclare "silence" que ce qui est clairement
    # sous le niveau de parole (p95). Évite de couper sur musique/bruit de fond.
    thr = max(8e-4, float(np.percentile(rms, 95)) * 0.05)
    voiced = rms > thr
    # Dilatation d'1 fenêtre de chaque côté : ne pas hacher l'intérieur des mots.
    dilated = voiced.copy()
    dilated[1:] |= voiced[:-1]
    dilated[:-1] |= voiced[1:]
    return dilated, hop


def snap_blocks_to_voice(blocks: list, voiced: np.ndarray, hop: float,
                         lead_max: float = 1.2) -> None:
    """
    Recale les bornes d'affichage des blocs sur l'activité vocale réelle :
    - début : si le bloc démarre dans le silence, on le repousse au premier son
      (le texte n'apparaît plus avant que la parole commence) ;
    - fin : si le bloc se termine dans le silence, on le ramène juste après le
      dernier son (le texte ne reste plus affiché pendant un blanc).
    Modifie les blocs en place ; les timings des mots (karaoké) restent intacts.
    """
    n = len(voiced)

    def first_voiced(t0: float, t1: float):
        i0, i1 = max(0, int(t0 / hop)), min(n, int(t1 / hop) + 1)
        for i in range(i0, i1):
            if voiced[i]:
                return i * hop
        return None

    def last_voiced(t0: float, t1: float):
        i0, i1 = max(0, int(t0 / hop)), min(n, int(t1 / hop) + 1)
        for i in range(i1 - 1, i0 - 1, -1):
            if voiced[i]:
                return (i + 1) * hop
        return None

    def is_voiced_near(t: float, margin: float = 0.15) -> bool:
        return first_voiced(t - margin, t + margin) is not None

    for b in blocks:
        s, e = b["bloc_start"], b["bloc_end"]
        # Début en avance sur la parole → repousser au premier son du bloc
        if not is_voiced_near(s):
            fv = first_voiced(s, min(e, s + lead_max))
            if fv is not None and fv > s:
                b["bloc_start"] = min(fv, e - 0.1)
        # Fin qui traîne dans le silence → ramener au dernier son du bloc (+ petite grâce)
        if not is_voiced_near(e):
            lv = last_voiced(b["bloc_start"], e)
            if lv is not None and lv < e:
                b["bloc_end"] = max(b["bloc_start"] + 0.3, lv + 0.15)

    # Les blocs ne doivent pas se chevaucher (min_block_duration peut étendre une fin
    # au-delà du début suivant) : le bloc suivant a priorité.
    for i in range(len(blocks) - 1):
        if blocks[i]["bloc_end"] > blocks[i + 1]["bloc_start"]:
            blocks[i]["bloc_end"] = blocks[i + 1]["bloc_start"]


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
    font_size = 80 if is_split else 96
    font_small = 66 if is_split else 78
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


# Position : ~63% — au-dessus du chrome TikTok/Reels (pseudo, boutons, captions).
SAFE_BOTTOM_RATIO = 0.63
# Contour circulaire (MrBeast / CapCut) — plus lisible qu'un offset cardinal 3px.
OUTLINE_RADIUS = 6
OUTLINE_RADIUS_IMPACT = 9
ACTIVE_WORD_POP = 1.12
_OUTLINE_OFFSETS_CACHE: dict[int, list[tuple[int, int]]] = {}

# Split 9:16 asymétrique (réf. interview) : primary en haut ~60%, secondary en bas ~40%.
SPLIT_TOP_H = 1152
SPLIT_BOTTOM_H = 768
SPLIT_SEPARATOR_PX = 4
# Sous-titres ancrés juste sous le séparateur (pas sur le visage du panneau bas).
SPLIT_SUBTITLE_TOP_PAD = 36
# Zoom split : assez serré pour isoler chaque tête. À 1.14 le crop couvre ~46% de
# la largeur source → si les 2 cx ne sont séparés que de ~0.25, les deux panneaux
# cadrent la même personne. ≥1.42 → ~36% de largeur, isolation correcte dès dist≈0.32.
SPLIT_FACE_ZOOM = 1.42
# Écart horizontal mini entre centres top/bottom (sinon même visage doublé).
SPLIT_MIN_CENTER_SEP = 0.32


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def _safe_y_base(height: int, content_h: int, layout_mode: str = "normal") -> int:
    if layout_mode == "split_vertical":
        # Niveau constant : haut du bloc juste sous le séparateur, au-dessus du visage.
        # (content_h ignoré — le bloc grandit vers le bas, pas vers le visage.)
        return SPLIT_TOP_H + SPLIT_SEPARATOR_PX + SPLIT_SUBTITLE_TOP_PAD
    return int(height * SAFE_BOTTOM_RATIO) - content_h



def _outline_offsets(radius: int) -> list[tuple[int, int]]:
    """Anneaux multi-directions pour un stroke plein (pas seulement 4 cardinaux)."""
    cached = _OUTLINE_OFFSETS_CACHE.get(radius)
    if cached is not None:
        return cached
    offs: list[tuple[int, int]] = []
    steps = max(12, radius * 4)
    for r in range(1, radius + 1):
        for i in range(steps):
            a = (2 * math.pi * i) / steps
            offs.append((int(round(r * math.cos(a))), int(round(r * math.sin(a)))))
    # Déduplique en gardant l'ordre
    uniq = list(dict.fromkeys(offs))
    _OUTLINE_OFFSETS_CACHE[radius] = uniq
    return uniq


def _is_active_word(word_obj: dict, active_word: dict | None) -> bool:
    """Match par identité (évite le double-highlight si le même mot apparaît 2×)."""
    return active_word is not None and word_obj is active_word


def _draw_outlined_text(
    draw: ImageDraw.ImageDraw,
    xy: tuple[float, float],
    text: str,
    font,
    fill: tuple[int, ...],
    outline_rgb: tuple[int, int, int] = (0, 0, 0),
    outline_radius: int = OUTLINE_RADIUS,
    shadow: bool = True,
) -> None:
    x, y = xy
    if shadow:
        # Ombre portée douce — aide la lisibilité sur fond sombre (où le stroke noir disparaît)
        for off, alpha in ((5, 70), (3, 110)):
            draw.text((x + off, y + off + 1), text, font=font, fill=(0, 0, 0, alpha))
    o_fill = (*outline_rgb, 255)
    for dx, dy in _outline_offsets(outline_radius):
        draw.text((x + dx, y + dy), text, font=font, fill=o_fill)
    draw.text((x, y), text, font=font, fill=fill)


def _draw_word(
    draw: ImageDraw.ImageDraw,
    img: Image.Image,
    x: float,
    y: float,
    word: str,
    font,
    fill: tuple[int, ...],
    *,
    outline_rgb: tuple[int, int, int] = (0, 0, 0),
    outline_radius: int = OUTLINE_RADIUS,
    pop: float = 1.0,
    shadow: bool = True,
) -> float:
    """Dessine un mot (contour + ombre), avec pop optionnel. Retourne l'avance (espace inclus)."""
    advance = _textlength(draw, word + " ", font)
    if abs(pop - 1.0) < 0.01:
        _draw_outlined_text(
            draw, (x, y), word, font, fill, outline_rgb, outline_radius, shadow
        )
        return advance

    pad = outline_radius + 10
    bbox = draw.textbbox((0, 0), word, font=font)
    tw = max(1, bbox[2] - bbox[0])
    th = max(1, bbox[3] - bbox[1])
    tmp = Image.new("RGBA", (tw + pad * 2, th + pad * 2), (0, 0, 0, 0))
    tmp_draw = ImageDraw.Draw(tmp)
    ox = pad - bbox[0]
    oy = pad - bbox[1]
    _draw_outlined_text(
        tmp_draw, (ox, oy), word, font, fill, outline_rgb, outline_radius, shadow
    )
    new_w = max(1, int(tmp.width * pop))
    new_h = max(1, int(tmp.height * pop))
    scaled = tmp.resize((new_w, new_h), Image.Resampling.LANCZOS)
    cx = x + tw / 2
    cy = y + (bbox[1] + bbox[3]) / 2
    paste_x = int(round(cx - new_w / 2))
    paste_y = int(round(cy - new_h / 2))
    img.alpha_composite(scaled, (paste_x, paste_y))
    return advance


def _render_impact_frame(
    width: int,
    height: int,
    bloc: dict,
    active_word: dict | None,
    style: str,
    font_path: str,
    layout_mode: str = "normal",
) -> np.ndarray:
    """Impact : 2 mots par bloc, très grands. Mot actif lime + pop, stroke épais."""
    colors = STYLE_COLORS.get(style, STYLE_COLORS["impact"])
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    words_data = bloc.get("words", [])
    if not words_data:
        return np.array(img)

    is_split = layout_mode == "split_vertical"
    margin_x = int(width * 0.07)
    max_line_w = width - 2 * margin_x
    active_rgb = _hex_to_rgb(colors["active"])
    contour_rgb = _hex_to_rgb(colors["contour"])

    # Auto-scale : réduire la police jusqu'à ce que la ligne la plus large rentre
    for font_size in ([96, 84, 72, 60, 50, 40] if is_split else [136, 120, 104, 88, 72, 56]):
        font = _load_title_font(font_path, font_size)
        line_h = int(font_size * 1.22)

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

        fits = all(
            _textlength(draw, " ".join(w["word"] for w in line), font) <= max_line_w
            for line in lines
        )
        if fits:
            break

    total_h = len(lines) * line_h
    y_base = _safe_y_base(height, total_h, layout_mode)

    for line_words in lines:
        line_text_w = _textlength(draw, " ".join(w["word"] for w in line_words), font)
        x = (width - line_text_w) / 2

        for w in line_words:
            word = w["word"]
            is_active = _is_active_word(w, active_word)
            fill_color = (*active_rgb, 255) if is_active else (255, 255, 255, 255)
            x += _draw_word(
                draw,
                img,
                x,
                y_base,
                word,
                font,
                fill_color,
                outline_rgb=contour_rgb,
                outline_radius=OUTLINE_RADIUS_IMPACT,
                pop=ACTIVE_WORD_POP if is_active else 1.0,
                shadow=True,
            )

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

    n_lines = len(lines)
    y_base = _safe_y_base(height, line_height * n_lines, layout_mode)

    max_line_w = max(
        _line_width_total(draw, line, font, font_small_obj) for line in lines
    ) if lines else 0

    pad_x, pad_y, box_radius = 28, 16, 18
    box_x1 = (width - max_line_w) / 2 - pad_x
    box_y1 = y_base - pad_y
    box_x2 = (width + max_line_w) / 2 + pad_x
    box_y2 = y_base + line_height * n_lines + pad_y

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
            is_active = _is_active_word(word_obj, active_word)
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
    colors = STYLE_COLORS.get(style, STYLE_COLORS["highlight"])
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    is_split = layout_mode == "split_vertical"
    words_data = bloc["words"]
    lines, font, font_small_obj, line_height = _layout_subtitle_lines(
        words_data, width, font_path, is_split, draw
    )
    n_lines = len(lines)
    y_base = _safe_y_base(height, line_height * n_lines, layout_mode)
    active_rgb = _hex_to_rgb(colors["active"])
    contour_rgb = _hex_to_rgb(colors["contour"])

    for line_idx, line_words in enumerate(lines):
        line_width = _line_width_total(draw, line_words, font, font_small_obj)
        x = (width - line_width) / 2
        y = y_base + line_idx * line_height

        for word_obj in line_words:
            word = word_obj["word"]
            is_active = _is_active_word(word_obj, active_word)
            f = _word_font(word, font, font_small_obj)
            bbox = draw.textbbox((0, 0), word, font=f)
            glyph_w = bbox[2] - bbox[0]

            if is_active:
                pad_x, pad_y = 8, 5
                draw.rectangle(
                    [x - pad_x, y + bbox[1] - pad_y,
                     x + glyph_w + pad_x, y + bbox[3] + pad_y],
                    fill=(*active_rgb, 215),
                )
                draw.text((x, y), word, font=f, fill=(15, 15, 15, 255))
                x += _textlength(draw, word + " ", f)
            else:
                x += _draw_word(
                    draw, img, x, y, word, f, (255, 255, 255, 255),
                    outline_rgb=contour_rgb, outline_radius=OUTLINE_RADIUS, pop=1.0,
                )

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
    colors = STYLE_COLORS.get(style, STYLE_COLORS["neon"])
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    is_split = layout_mode == "split_vertical"
    words_data = bloc["words"]
    lines, font, font_small_obj, line_height = _layout_subtitle_lines(
        words_data, width, font_path, is_split, draw
    )
    n_lines = len(lines)
    y_base = _safe_y_base(height, line_height * n_lines, layout_mode)
    active_rgb = _hex_to_rgb(colors["active"])
    contour_rgb = _hex_to_rgb(colors["contour"])

    for line_idx, line_words in enumerate(lines):
        line_width = _line_width_total(draw, line_words, font, font_small_obj)
        x = (width - line_width) / 2
        y = y_base + line_idx * line_height

        for word_obj in line_words:
            word = word_obj["word"]
            is_active = _is_active_word(word_obj, active_word)
            f = _word_font(word, font, font_small_obj)

            if is_active:
                glow_layers = [(12, 28), (8, 55), (5, 95), (3, 140), (2, 190)]
                for offset, alpha in glow_layers:
                    for dx in (-offset, 0, offset):
                        for dy in (-offset, 0, offset):
                            if dx == 0 and dy == 0:
                                continue
                            draw.text((x + dx, y + dy), word, font=f, fill=(*active_rgb, alpha))
                draw.text((x + 1, y + 1), word, font=f, fill=(0, 0, 0, 120))
                draw.text((x, y), word, font=f, fill=(255, 255, 255, 255))
                x += _textlength(draw, word + " ", f)
            else:
                inactive_rgb = _hex_to_rgb(colors["inactive"])
                x += _draw_word(
                    draw, img, x, y, word, f, (*inactive_rgb, 190),
                    outline_rgb=contour_rgb, outline_radius=3, pop=1.0, shadow=False,
                )

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
    colors = STYLE_COLORS.get(style, STYLE_COLORS["sunset"])
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    is_split = layout_mode == "split_vertical"
    words_data = bloc["words"]
    lines, font, font_small_obj, line_height = _layout_subtitle_lines(
        words_data, width, font_path, is_split, draw
    )
    n_lines = len(lines)
    y_base = _safe_y_base(height, line_height * n_lines, layout_mode)
    active_rgb = _hex_to_rgb(colors["active"])
    contour_rgb = _hex_to_rgb(colors["contour"])
    light_rgb = (
        min(255, active_rgb[0] + 90),
        min(255, active_rgb[1] + 60),
        min(255, active_rgb[2] + 40),
    )

    for line_idx, line_words in enumerate(lines):
        line_width = _line_width_total(draw, line_words, font, font_small_obj)
        x = (width - line_width) / 2
        y = y_base + line_idx * line_height

        for word_obj in line_words:
            word = word_obj["word"]
            is_active = _is_active_word(word_obj, active_word)
            f = _word_font(word, font, font_small_obj)

            if is_active:
                _draw_outlined_text(
                    draw, (x, y), word, f, (*active_rgb, 255),
                    outline_rgb=contour_rgb, outline_radius=OUTLINE_RADIUS, shadow=True,
                )
                draw.text((x - 1, y - 2), word, font=f, fill=(*light_rgb, 140))
                x += _textlength(draw, word + " ", f)
            else:
                x += _draw_word(
                    draw, img, x, y, word, f, (255, 255, 255, 255),
                    outline_rgb=contour_rgb, outline_radius=OUTLINE_RADIUS,
                    pop=1.0, shadow=True,
                )

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
    """Minimal : pas de pilule ni de boîte. Mot actif coloré + léger pop, contour fin."""
    colors = STYLE_COLORS.get(style, STYLE_COLORS["minimal"])
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    is_split = layout_mode == "split_vertical"
    words_data = bloc["words"]
    lines, font, font_small_obj, line_height = _layout_subtitle_lines(
        words_data, width, font_path, is_split, draw
    )
    n_lines = len(lines)
    y_base = _safe_y_base(height, line_height * n_lines, layout_mode)
    active_rgb = _hex_to_rgb(colors["active"])
    inactive_rgb = _hex_to_rgb(colors["inactive"])
    contour_rgb = _hex_to_rgb(colors["contour"])

    for line_idx, line_words in enumerate(lines):
        line_width = _line_width_total(draw, line_words, font, font_small_obj)
        x = (width - line_width) / 2
        y = y_base + line_idx * line_height

        for word_obj in line_words:
            word = word_obj["word"]
            is_active = _is_active_word(word_obj, active_word)
            f = _word_font(word, font, font_small_obj)
            fill = (*active_rgb, 255) if is_active else (*inactive_rgb, 175)
            x += _draw_word(
                draw, img, x, y, word, f, fill,
                outline_rgb=contour_rgb, outline_radius=2,
                pop=1.08 if is_active else 1.0, shadow=False,
            )

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

    n_lines = len(lines)
    y_base = _safe_y_base(height, line_height * n_lines, layout_mode)
    contour_rgb = _hex_to_rgb(colors["contour"])
    inactive_rgb = _hex_to_rgb(colors["inactive"])

    for line_idx, line_words in enumerate(lines):
        line_width = _line_width_total(draw, line_words, font, font_small_obj)
        x = (width - line_width) / 2
        y = y_base + line_idx * line_height

        for word_obj in line_words:
            word = word_obj["word"]
            is_active = _is_active_word(word_obj, active_word)
            f = font_small_obj if len(word) > 10 else font

            if is_active:
                hw_pad_x, hw_pad_y, hw_radius = 10, 7, 10
                active_rgb = _hex_to_rgb(colors["active"])
                bbox = draw.textbbox((0, 0), word, font=f)
                glyph_w = bbox[2] - bbox[0]
                # Pilule un peu plus large pour absorber le pop
                cx = x + glyph_w / 2
                cy = y + (bbox[1] + bbox[3]) / 2
                half_w = (glyph_w / 2 + hw_pad_x) * ACTIVE_WORD_POP
                half_h = ((bbox[3] - bbox[1]) / 2 + hw_pad_y) * ACTIVE_WORD_POP
                draw.rounded_rectangle(
                    [cx - half_w, cy - half_h, cx + half_w, cy + half_h],
                    radius=int(hw_radius * ACTIVE_WORD_POP),
                    fill=(*active_rgb, 255),
                )
                x += _draw_word(
                    draw, img, x, y, word, f, (255, 255, 255, 255),
                    outline_rgb=contour_rgb, outline_radius=2,
                    pop=ACTIVE_WORD_POP, shadow=False,
                )
            else:
                x += _draw_word(
                    draw, img, x, y, word, f, (*inactive_rgb, 255),
                    outline_rgb=contour_rgb, outline_radius=OUTLINE_RADIUS,
                    pop=1.0, shadow=True,
                )

    return np.array(img)


def overlay_alpha_bbox(overlay_rgba: np.ndarray) -> tuple[int, int, int, int] | None:
    """Bounding box (y0, y1, x0, x1) des pixels non transparents, ou None si vide."""
    ys, xs = np.nonzero(overlay_rgba[:, :, 3])
    if ys.size == 0:
        return None
    return int(ys.min()), int(ys.max()) + 1, int(xs.min()), int(xs.max()) + 1


def blend_overlay(
    frame_bgr: np.ndarray,
    overlay_rgba: np.ndarray,
    bbox: tuple[int, int, int, int] | None = None,
) -> np.ndarray:
    """Fusionne l'overlay RGBA sur la frame BGR (in place).

    Le blend est restreint à la bounding box du texte (le sous-titre n'occupe
    qu'une petite bande de l'image) : passer `bbox` pré-calculée via
    overlay_alpha_bbox évite de la recalculer à chaque frame.
    """
    if bbox is None:
        bbox = overlay_alpha_bbox(overlay_rgba)
    if bbox is None:
        return frame_bgr
    y0, y1, x0, x1 = bbox
    region = frame_bgr[y0:y1, x0:x1]
    ov = overlay_rgba[y0:y1, x0:x1]
    # L'overlay PIL est en RGB ; on le réordonne en BGR au lieu de convertir la
    # frame entière dans les deux sens.
    ov_bgr = ov[:, :, 2::-1]
    alpha = ov[:, :, 3:4] / 255.0
    frame_bgr[y0:y1, x0:x1] = (alpha * ov_bgr + (1 - alpha) * region).astype(np.uint8)
    return frame_bgr


# Détecteurs de visages pour crop intelligent (chargés une seule fois)
_FRONTAL_CASCADE = None
_PROFILE_CASCADE = None


def _get_frontal_cascade():
    global _FRONTAL_CASCADE
    if _FRONTAL_CASCADE is None:
        path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        c = cv2.CascadeClassifier(path)
        _FRONTAL_CASCADE = c if not c.empty() else False  # False = fichier absent
    return _FRONTAL_CASCADE if _FRONTAL_CASCADE is not False else None


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

    # 2. Haar cascade frontal (best-effort : un cascade absent/corrompu ne doit
    # jamais faire planter le rendu — au pire on perd juste le smart-crop)
    try:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        h, w = frame.shape[:2]

        frontal = _get_frontal_cascade()
        if frontal is not None:
            pos = _detect_with_cascade(frontal, gray, w, h)
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
    except Exception:
        pass

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
            # 0.5 : short-range rate les plans usine / lunettes / casquettes si trop haut
            min_detection_confidence=0.5,
            min_suppression_threshold=0.3,
        )
        _MP_FACE_DETECTOR = mp.tasks.vision.FaceDetector.create_from_options(options)
    return _MP_FACE_DETECTOR


def _merge_face_candidates(
    raw: list[tuple[float, float, float]],
    min_area_ratio: float,
    min_horizontal_distance: float,
    min_absolute_area: float,
) -> list[tuple[float, float, float]]:
    if not raw:
        return []
    max_area = max(r[2] for r in raw)
    filtered = [r for r in raw if r[2] >= min_area_ratio * max_area and r[2] >= min_absolute_area]
    filtered.sort(key=lambda r: -r[2])
    kept: list[tuple[float, float, float]] = []
    for face in filtered:
        too_close = False
        for i, existing in enumerate(kept):
            if abs(face[0] - existing[0]) < min_horizontal_distance:
                too_close = True
                # Garde le plus grand (déjà trié) ; ignore le doublon
                break
        if not too_close:
            kept.append(face)
    return kept


def _detect_faces_mp_raw(frame: np.ndarray) -> list[tuple[float, float, float]]:
    detector = _get_mp_face_detector()
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    result = detector.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
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
    return raw


def _detect_faces_haar_raw(frame: np.ndarray) -> list[tuple[float, float, float]]:
    """Haar frontal + profil — meilleur que BlazeFace short-range sur plans moyens usine."""
    h_frame, w_frame = frame.shape[:2]
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    raw: list[tuple[float, float, float]] = []
    frontal = _get_frontal_cascade()
    if frontal is not None:
        for x, y, w, h in frontal.detectMultiScale(
            gray, scaleFactor=1.08, minNeighbors=4, minSize=(40, 40)
        ):
            raw.append(((x + w / 2) / w_frame, (y + h / 2) / h_frame, (w / w_frame) * (h / h_frame)))
    profile = _get_profile_cascade()
    if profile is not None:
        for x, y, w, h in profile.detectMultiScale(
            gray, scaleFactor=1.08, minNeighbors=4, minSize=(40, 40)
        ):
            raw.append(((x + w / 2) / w_frame, (y + h / 2) / h_frame, (w / w_frame) * (h / h_frame)))
        flipped = cv2.flip(gray, 1)
        for x, y, w, h in profile.detectMultiScale(
            flipped, scaleFactor=1.08, minNeighbors=4, minSize=(40, 40)
        ):
            cx = 1.0 - (x + w / 2) / w_frame
            raw.append((cx, (y + h / 2) / h_frame, (w / w_frame) * (h / h_frame)))
    return raw


def detect_all_faces_mp(
    frame: np.ndarray,
    min_area_ratio: float = 0.35,
    min_horizontal_distance: float = 0.25,
    min_absolute_area: float = 0.005,
) -> list[tuple[float, float, float]]:
    """
    Detect all faces — MediaPipe short-range + moitiés upscalées + Haar.

    BlazeFace short-range rate souvent les 2-shots usine (visages trop petits /
    lunettes / casquettes). On combine plusieurs passes.

    Returns a list of (cx, cy, area_ratio) normalised 0-1.
    """
    h_frame, w_frame = frame.shape[:2]
    raw: list[tuple[float, float, float]] = []

    try:
        raw.extend(_detect_faces_mp_raw(frame))
    except Exception:
        pass

    # Plans côte-à-côte : détecter chaque moitié upscalée ×2 (short-range préfère les gros visages)
    try:
        overlap = w_frame // 10
        halves = (
            (0, w_frame // 2 + overlap, 0),
            (max(0, w_frame // 2 - overlap), w_frame, max(0, w_frame // 2 - overlap)),
        )
        for x0, x1, _xoff in halves:
            crop = frame[:, x0:x1]
            if crop.size == 0:
                continue
            big = cv2.resize(crop, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_LINEAR)
            local = _detect_faces_mp_raw(big)
            span = (x1 - x0) / w_frame
            for cx, cy, area in local:
                raw.append((x0 / w_frame + cx * span, cy, area * span))
    except Exception:
        pass

    try:
        raw.extend(_detect_faces_haar_raw(frame))
    except Exception:
        pass

    return _merge_face_candidates(raw, min_area_ratio, min_horizontal_distance, min_absolute_area)


def analyze_face_count_for_clip(
    video_path: str,
    start: float,
    end: float,
    sample_interval: float = 1.2,
    multi_face_threshold: float = 0.65,
) -> dict:
    """
    Sample frames from [start, end] and count how many show a real 2-shot.

    Un 2-shot compte seulement si 2 visages sont séparés horizontalement ET
    de taille comparable — évite talking-head + fantôme (ouvrier flou / artefact).
    """
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    duration = end - start
    num_samples = max(1, int(duration / sample_interval))

    multi_face_count = 0
    # Cluster by horizontal side (left/right) so the same person stays in the same slot.
    left_samples: list[tuple[float, float, float]] = []
    right_samples: list[tuple[float, float, float]] = []

    for i in range(num_samples):
        t = start + (i + 0.5) * (duration / num_samples)
        frame_idx = int(t * fps)
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ret, frame = cap.read()
        if not ret:
            continue

        faces = detect_all_faces_mp(
            frame,
            min_area_ratio=0.28,
            min_absolute_area=0.0035,
            min_horizontal_distance=0.18,
        )
        if len(faces) < 2:
            continue
        f0, f1 = faces[0], faces[1]
        dist = abs(f0[0] - f1[0])
        area_ratio = (f1[2] / f0[2]) if f0[2] > 0 else 0.0
        # Gros plan solo : 2e "visage" souvent << 30% de l'aire → on ignore
        # dist trop faible → les deux crops se chevauchent = même personne en double
        if dist < 0.28 or area_ratio < 0.30:
            continue
        multi_face_count += 1
        ordered = sorted((f0, f1), key=lambda f: f[0])  # left → right
        left_samples.append(ordered[0])
        right_samples.append(ordered[1])

    cap.release()

    confidence = multi_face_count / num_samples if num_samples > 0 else 0.0
    face_count_mode = 2 if confidence >= multi_face_threshold else 1

    def _median_face(samples: list[tuple[float, float, float]]) -> dict[str, float] | None:
        if not samples:
            return None
        xs = sorted(s[0] for s in samples)
        ys = sorted(s[1] for s in samples)
        areas = sorted(s[2] for s in samples)
        mid = len(samples) // 2
        return {"cx": xs[mid], "cy": ys[mid], "area": areas[mid]}

    left = _median_face(left_samples)
    right = _median_face(right_samples)
    median_positions: list[dict[str, float]] = []
    area_ratio = 0.0
    if left and right:
        sep = abs(left["cx"] - right["cx"])
        # Médianes trop proches = double détection de la même tête (moitiés MP / Haar)
        if sep >= SPLIT_MIN_CENTER_SEP:
            # Primary (top, larger panel) = visage médian le plus grand.
            primary, secondary = (left, right) if left["area"] >= right["area"] else (right, left)
            median_positions = [primary, secondary]
            if primary["area"] > 0:
                area_ratio = secondary["area"] / primary["area"]
        else:
            print(
                f"[FACES] median L/R trop proches (sep={sep:.3f} < {SPLIT_MIN_CENTER_SEP}) — pas de split positions",
                flush=True,
            )

    return {
        "face_count_mode": face_count_mode,
        "confidence": round(confidence, 3),
        "total_sampled": num_samples,
        "multi_face_frames": multi_face_count,
        "median_positions": median_positions,
        "area_ratio": round(area_ratio, 3),
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
    top_h: int = SPLIT_TOP_H,
    bottom_h: int = SPLIT_BOTTOM_H,
    out_w: int = 1080,
    separator_px: int = SPLIT_SEPARATOR_PX,
) -> np.ndarray:
    """
    Produit un frame split vertical asymétrique 9:16 :
    - haut = personne principale (~60%, top_h)
    - bas = seconde personne (~40%, bottom_h)
    center_top / center_bottom : (cx, cy) normalisés 0-1 pour chaque panneau.
    """
    src_h, src_w = frame.shape[:2]
    # Un seul scale pour les deux panneaux (même zoom relatif), dimensionné
    # pour remplir le panneau le plus exigeant en hauteur.
    max_panel_h = max(top_h, bottom_h)
    scale = max(out_w / src_w, max_panel_h / src_h)
    # Zoom serré : isole chaque tête (évite A+A quand les cx sont proches).
    scale *= SPLIT_FACE_ZOOM
    new_w = max(out_w, int(src_w * scale))
    new_h = max(max_panel_h, int(src_h * scale))
    scaled = cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_LANCZOS4)

    def crop_at_center(cx: float, cy: float, panel_h: int) -> np.ndarray:
        # Visage ~38% depuis le haut du panneau (règle des tiers), pas pile au centre.
        face_y_in_panel = 0.38
        cy_n = max(0.16, min(0.52, cy - 0.03))
        center_x = int(cx * new_w)
        # Place le visage à face_y_in_panel dans le panneau, pas au milieu géométrique.
        center_y = int(cy_n * new_h)
        y1 = int(center_y - panel_h * face_y_in_panel)
        y1 = max(0, min(y1, new_h - panel_h))
        y2 = y1 + panel_h
        x1 = max(0, min(center_x - out_w // 2, new_w - out_w))
        x2 = x1 + out_w
        crop = scaled[y1:y2, x1:x2]
        if crop.shape[0] != panel_h or crop.shape[1] != out_w:
            crop = cv2.resize(crop, (out_w, panel_h), interpolation=cv2.INTER_LANCZOS4)
        return crop

    # Ajuste les hauteurs si un séparateur est présent pour rester à 1920 pile.
    out_total = 1920
    if separator_px > 0:
        usable = out_total - separator_px
        top_h = int(round(usable * (SPLIT_TOP_H / (SPLIT_TOP_H + SPLIT_BOTTOM_H))))
        bottom_h = usable - top_h
    else:
        top_h = SPLIT_TOP_H
        bottom_h = SPLIT_BOTTOM_H

    # Force une séparation mini des centres avant crop (filet de sécurité).
    cx_t, cy_t = float(center_top[0]), float(center_top[1])
    cx_b, cy_b = float(center_bottom[0]), float(center_bottom[1])
    if abs(cx_t - cx_b) < SPLIT_MIN_CENTER_SEP:
        left_cx, right_cx = (cx_t, cx_b) if cx_t <= cx_b else (cx_b, cx_t)
        mid = 0.5 * (left_cx + right_cx)
        half = SPLIT_MIN_CENTER_SEP / 2.0
        left_cx, right_cx = mid - half, mid + half
        if cx_t <= cx_b:
            cx_t, cx_b = left_cx, right_cx
        else:
            cx_t, cx_b = right_cx, left_cx

    top_crop = crop_at_center(cx_t, cy_t, top_h)
    bottom_crop = crop_at_center(cx_b, cy_b, bottom_h)

    if separator_px > 0:
        sep = np.full((separator_px, out_w, 3), (28, 28, 28), dtype=np.uint8)
        stacked = np.vstack([top_crop, sep, bottom_crop])
    else:
        stacked = np.vstack([top_crop, bottom_crop])

    if stacked.shape[0] != out_total or stacked.shape[1] != out_w:
        stacked = cv2.resize(stacked, (out_w, out_total), interpolation=cv2.INTER_LANCZOS4)
    return stacked


def get_split_centers_for_frame(
    frame: np.ndarray,
    prev_top: tuple[float, float] | None,
    prev_bottom: tuple[float, float] | None,
    init_positions: list[dict],
    frame_idx: int,
    smoothing: float = 0.99,
    max_step: float = 0.003,
    deadzone: float = 0.04,
    recalib_interval: int = 50,
    remap_conflict_max: float = 0.05,
) -> tuple[tuple[float, float], tuple[float, float]]:
    """
    Retourne (center_top, center_bottom) pour cette frame.
    Tracking très lent + identité verrouillée (gauche/droite selon init) pour
    éviter les pans L/R visibles sur plans stables (interview assise, etc.).
    """
    fallback_top = (init_positions[0]["cx"], init_positions[0]["cy"]) if len(init_positions) > 0 else (0.33, 0.4)
    fallback_bottom = (init_positions[1]["cx"], init_positions[1]["cy"]) if len(init_positions) > 1 else (0.67, 0.4)
    # Qui est à gauche au départ ? On garde cette association top/bottom.
    top_is_left = fallback_top[0] <= fallback_bottom[0]

    target_top = prev_top if prev_top else fallback_top
    target_bottom = prev_bottom if prev_bottom else fallback_bottom

    # ~0.6× / seconde à 30fps — moins de recalibrages = moins de micro-pans
    if frame_idx % recalib_interval == 0:
        faces = detect_all_faces_mp(
            frame,
            min_area_ratio=0.2,
            min_absolute_area=0.002,
            min_horizontal_distance=0.18,
        )
        if len(faces) >= 2:
            # 1) Assigne par proximité aux tracks (évite les sauts)
            remaining = [(f[0], f[1], f[2]) for f in faces[:4]]
            remaining_faces_snapshot = list(remaining)

            def _take_nearest(anchor: tuple[float, float]) -> tuple[float, float]:
                best_i, best_d = 0, 1e9
                for i, f in enumerate(remaining):
                    d = (f[0] - anchor[0]) ** 2 + (f[1] - anchor[1]) ** 2
                    if d < best_d:
                        best_i, best_d = i, d
                f = remaining.pop(best_i)
                return (f[0], f[1])

            near_top = _take_nearest(target_top)
            near_bot = _take_nearest(target_bottom)
            cand_top, cand_bot = near_top, near_bot

            # 2) Si clairement L/R, ré-impose l'ordre init — mais refuse le remap
            #    s'il contredit trop le track de proximité (évite le "fight" qui
            #    provoque un pan horizontal visible).
            if abs(near_top[0] - near_bot[0]) > 0.12:
                left, right = (near_top, near_bot) if near_top[0] <= near_bot[0] else (near_bot, near_top)
                remapped_top, remapped_bot = (left, right) if top_is_left else (right, left)
                conflict = (
                    abs(remapped_top[0] - near_top[0])
                    + abs(remapped_top[1] - near_top[1])
                    + abs(remapped_bot[0] - near_bot[0])
                    + abs(remapped_bot[1] - near_bot[1])
                )
                if conflict <= remap_conflict_max:
                    cand_top, cand_bot = remapped_top, remapped_bot
                # sinon : garder near_* (pas de jump remap vs proximity)

            # 3) Refuse toute cible où les 2 centres collapsent sur la même tête
            if abs(cand_top[0] - cand_bot[0]) < SPLIT_MIN_CENTER_SEP:
                # Ré-assigne strictement L/R depuis les détections brutes
                by_x = sorted(remaining_faces_snapshot, key=lambda f: f[0])
                if len(by_x) >= 2 and abs(by_x[0][0] - by_x[-1][0]) >= SPLIT_MIN_CENTER_SEP:
                    left, right = (by_x[0][0], by_x[0][1]), (by_x[-1][0], by_x[-1][1])
                    cand_top, cand_bot = (left, right) if top_is_left else (right, left)
                else:
                    # Garde les cibles précédentes (pas de collapse A+A)
                    cand_top, cand_bot = target_top, target_bottom

            if prev_top is None or abs(cand_top[0] - prev_top[0]) + abs(cand_top[1] - prev_top[1]) > deadzone:
                target_top = cand_top
            if prev_bottom is None or abs(cand_bot[0] - prev_bottom[0]) + abs(cand_bot[1] - prev_bottom[1]) > deadzone:
                target_bottom = cand_bot
        # < 2 visages : on garde la cible précédente (pas de pan vers le vide)

    def _clamp_step(prev: tuple[float, float], tgt: tuple[float, float]) -> tuple[float, float]:
        dx = max(-max_step, min(max_step, tgt[0] - prev[0]))
        dy = max(-max_step, min(max_step, tgt[1] - prev[1]))
        return (prev[0] + dx, prev[1] + dy)

    if prev_top and prev_bottom:
        eased_top = (
            smoothing * prev_top[0] + (1 - smoothing) * target_top[0],
            smoothing * prev_top[1] + (1 - smoothing) * target_top[1],
        )
        eased_bottom = (
            smoothing * prev_bottom[0] + (1 - smoothing) * target_bottom[0],
            smoothing * prev_bottom[1] + (1 - smoothing) * target_bottom[1],
        )
        out_top = _clamp_step(prev_top, eased_top)
        out_bot = _clamp_step(prev_bottom, eased_bottom)
        # Filet : ne jamais renvoyer deux centres trop proches
        if abs(out_top[0] - out_bot[0]) < SPLIT_MIN_CENTER_SEP:
            return (target_top, target_bottom) if abs(target_top[0] - target_bottom[0]) >= SPLIT_MIN_CENTER_SEP else (fallback_top, fallback_bottom)
        return (out_top, out_bot)
    return (target_top, target_bottom)


def build_dynamic_layout_mask(
    video_path: str,
    start: float,
    end: float,
    out_fps: float,
    clip_frames_out: int,
    sample_interval_sec: float = 0.55,
    enter_ratio: float = 0.62,
    exit_ratio: float = 0.35,
    min_hold_sec: float = 3.0,
    window_sec: float = 2.0,
) -> np.ndarray:
    """
    Timeline bool par frame de sortie : True = split, False = normal (smart-crop).

    Échantillonne les visages le long du clip. Passe en split seulement si une
    fenêtre glissante a assez de frames à 2 visages séparés ; revient en normal
    si les gens sont de dos / hors champ (hystérésis + durée mini entre switches).
    """
    cap = cv2.VideoCapture(video_path)
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 30.0) or 30.0
    duration = max(0.1, end - start)
    samples: list[tuple[float, bool]] = []  # (t_local, is_two_shot)

    t = 0.0
    while t < duration:
        frame_idx = int((start + t) * fps)
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ok, frame = cap.read()
        if ok:
            faces = detect_all_faces_mp(
                frame,
                min_area_ratio=0.18,
                min_absolute_area=0.0015,
                min_horizontal_distance=0.15,
            )
            two = False
            if len(faces) >= 2:
                dist = abs(faces[0][0] - faces[1][0])
                # Deux têtes visibles et séparées (pas un seul gros visage doublé)
                two = dist > 0.18 and faces[1][2] >= 0.35 * faces[0][2]
            samples.append((t, two))
        else:
            samples.append((t, False))
        t += sample_interval_sec
    cap.release()

    if not samples:
        return np.zeros(clip_frames_out, dtype=bool)

    mask = np.zeros(clip_frames_out, dtype=bool)
    in_split = False
    last_switch_t = -1e9
    half_w = window_sec / 2.0

    for i in range(clip_frames_out):
        t_i = i / out_fps if out_fps > 0 else 0.0
        nearby = [s for s in samples if abs(s[0] - t_i) <= half_w]
        if not nearby:
            nearby = [min(samples, key=lambda s: abs(s[0] - t_i))]
        ratio = sum(1 for _, two in nearby if two) / len(nearby)
        can_switch = (t_i - last_switch_t) >= min_hold_sec

        if in_split:
            # Sortie différée d'1 frame : la frame de décision reste en split.
            # Sinon on peint 1 frame mono trop tôt (souvent sur le mauvais visage
            # via largest-face) juste avant la vraie transition.
            mask[i] = True
            if can_switch and ratio < exit_ratio:
                in_split = False
                last_switch_t = t_i
        else:
            # Entrée différée d'1 frame : la frame de décision reste en normal.
            # Sinon on peint 1 frame de trop en split sur un plan encore mono
            # (centres fallback → panneau bas cassé juste avant le vrai two-shot).
            mask[i] = False
            if can_switch and ratio >= enter_ratio:
                in_split = True
                last_switch_t = t_i


    split_frames = int(mask.sum())
    print(
        f"[LAYOUT] dynamic mask: {split_frames}/{clip_frames_out} frames split "
        f"({100 * split_frames / max(1, clip_frames_out):.0f}%), "
        f"samples={len(samples)} two_shot={sum(1 for _, t in samples if t)}",
        flush=True,
    )
    return mask


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("video_path", help="Chemin vidéo source")
    parser.add_argument("start", type=float, help="Début du clip (s)")
    parser.add_argument("end", type=float, help="Fin du clip (s)")
    parser.add_argument("output_path", nargs="?", default=None, help="Chemin sortie MP4")
    parser.add_argument("transcription_path", nargs="?", default=None, help="JSON transcription")
    parser.add_argument(
        "--style",
        default="impact",
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
    parser.add_argument(
        "--talk-format",
        default="other",
        choices=["interview_podcast", "other"],
        help="Format détecté (podcast → hybrid plus accrocheur pour B-roll)",
    )
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
        # Impact : 2 mots (hooks viraux). Autres : 3 mots max, plus lisible en vertical.
        if args.style == "impact":
            blocks = group_into_blocks(words, max_per_block=2, min_block_duration=0.45)
        else:
            blocks = group_into_blocks(words, max_per_block=3, min_block_duration=0.35)
        # Recale les blocs sur l'audio réel : les timestamps Whisper dérivent parfois,
        # ce qui faisait apparaître le texte avant la parole ou le laissait affiché
        # pendant un silence.
        va = compute_voice_activity(args.video_path, args.start, args.end - args.start)
        if va is not None:
            snap_blocks_to_voice(blocks, *va)
            print(f"[VAD] blocs recalés sur l'activité vocale ({len(blocks)} blocs)", flush=True)
        else:
            print("[VAD] audio indisponible — timings Whisper conservés", flush=True)

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
    # Split éligible → on garde aussi le track mono pour les segments "retour à normal"
    need_mono_track = args.format == "9:16" and (args.smart_crop or use_split)
    use_smart_crop = need_mono_track and not use_split  # flag legacy pour logs mono-only
    hybrid_split = use_split  # peut basculer split↔normal frame par frame

    _smartcrop_path = (
        args.proxy_path
        if (args.proxy_path and os.path.exists(args.proxy_path))
        else None
    )

    cx_smooth: np.ndarray | None = None
    cy_smooth: np.ndarray | None = None
    layout_split_mask: np.ndarray | None = None
    t_pass1_start = time.monotonic()
    if need_mono_track:
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

    if hybrid_split:
        # Podcast/interview : seuils plus bas pour revenir en split après B-roll
        # (usine Tesla, etc.) dès que les 2 têtes réapparaissent.
        is_podcast = args.talk_format == "interview_podcast"
        layout_kwargs = (
            {"enter_ratio": 0.50, "exit_ratio": 0.28, "min_hold_sec": 3.0}
            if is_podcast
            else {"enter_ratio": 0.62, "exit_ratio": 0.35, "min_hold_sec": 3.0}
        )
        print(
            f"[LAYOUT] talk_format={args.talk_format} "
            f"enter={layout_kwargs['enter_ratio']} exit={layout_kwargs['exit_ratio']}",
            flush=True,
        )
        layout_split_mask = build_dynamic_layout_mask(
            args.video_path,
            args.start,
            args.end,
            out_fps,
            clip_frames_out,
            **layout_kwargs,
        )
        # Si aucune fenêtre n'est vraiment 2-shot, tombe en mono pur
        if layout_split_mask is not None and not bool(layout_split_mask.any()):
            print("[LAYOUT] no sustained two-shot — mono smart-crop for whole clip", flush=True)
            hybrid_split = False
            use_split = False

    t_pass1_end = time.monotonic()
    print(
        f"[TIMING] pass1 (smart-crop + layout) {t_pass1_end - t_pass1_start:.1f}s "
        f"(mono_track={'ON' if need_mono_track else 'OFF'} hybrid_split={'ON' if hybrid_split else 'OFF'})",
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
    # Après sortie split → mono : seed depuis le panneau top (visage principal)
    # puis lerp court vers le track mono, pour éviter 1 frame sur le non-speaker.
    was_split = False
    mono_exit_seed: tuple[float, float] | None = None
    mono_blend_left = 0
    mono_blend_total = max(1, int(round(out_fps * 0.25)))  # ~0.25s

    # Cache de l'overlay sous-titre : le bloc/mot actif reste souvent identique
    # sur plusieurs frames consécutives (ex. ~10 frames à 30fps pour un mot tenu
    # 0.3s) — recalculer le rendu PIL (texte + contour + ombre) à chaque frame
    # est le principal poste CPU du pipeline pour rien tant que rien n'a changé.
    overlay_cache_key: tuple[int, int | None] | None = None
    overlay_cache_img: np.ndarray | None = None
    overlay_cache_bbox: tuple[int, int, int, int] | None = None

    for i in range(clip_frames_out):
        if stride > 1 and i > 0:
            for _ in range(stride - 1):
                cap.read()
        ret, frame = cap.read()
        if not ret:
            break

        src_idx = min(i * stride, clip_frames_full - 1) if clip_frames_full > 0 else i
        t = i / out_fps
        frame_is_split = bool(
            hybrid_split and layout_split_mask is not None and layout_split_mask[min(i, len(layout_split_mask) - 1)]
        )
        if frame_is_split:
            center_top, center_bottom = get_split_centers_for_frame(
                frame, prev_split_top, prev_split_bottom, face_positions, i
            )
            prev_split_top, prev_split_bottom = center_top, center_bottom
            frame = resize_and_crop_split_frame(frame, center_top, center_bottom)
            was_split = True
            mono_blend_left = 0
            mono_exit_seed = None
        elif cx_smooth is not None and cy_smooth is not None:
            track_cx = float(cx_smooth[src_idx])
            track_cy = float(cy_smooth[src_idx])
            if was_split and prev_split_top is not None:
                # Première frame mono après split : ancrer sur le panneau top
                mono_exit_seed = prev_split_top
                mono_blend_left = mono_blend_total
                was_split = False
            if mono_blend_left > 0 and mono_exit_seed is not None:
                blend_t = 1.0 - (mono_blend_left / mono_blend_total)
                crop_center = (
                    mono_exit_seed[0] * (1.0 - blend_t) + track_cx * blend_t,
                    mono_exit_seed[1] * (1.0 - blend_t) + track_cy * blend_t,
                )
                mono_blend_left -= 1
            else:
                crop_center = (track_cx, track_cy)
            frame = resize_and_crop_frame(frame, out_w, out_h, crop_center)
        else:
            frame = resize_and_crop_frame(frame, out_w, out_h, None)
            was_split = False
            mono_blend_left = 0
            mono_exit_seed = None

        bloc = get_bloc_at_with_silence_gate(t, blocks)
        active_word = get_word_at(t, bloc) if bloc else None
        layout_mode = "split_vertical" if frame_is_split else "normal"

        if bloc and (active_word or bloc["words"]):
            cache_key = (id(bloc), id(active_word) if active_word is not None else None, layout_mode)
            if cache_key == overlay_cache_key and overlay_cache_img is not None:
                overlay = overlay_cache_img
            else:
                overlay = render_subtitle_frame(
                    out_w, out_h, bloc, active_word, args.style, font_path,
                    layout_mode=layout_mode,
                )
                overlay_cache_key = cache_key
                overlay_cache_img = overlay
                overlay_cache_bbox = overlay_alpha_bbox(overlay)
            if overlay_cache_bbox is not None:
                frame = blend_overlay(frame, overlay, overlay_cache_bbox)

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
