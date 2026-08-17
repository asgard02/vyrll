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
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import dataclass
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

EMOJI_REGEX = re.compile(
    r"[\U0001F300-\U0001F9FF\U00002600-\U000026FF\U00002700-\U000027BF]"
)

# Styles actifs (picker) + alias legacy.
# Couleurs alignées sur presets viraux (Hormozi / TikTok / caption-cast / CapCut).
# Sync avec src/lib/subtitle-style-colors.ts
STYLE_COLORS = {
    # Hormozi / MrBeast : or classique
    "impact":    {"active": "#FFD700", "inactive": "#FFFFFF", "contour": "#000000"},
    # TikTok karaoke green
    "karaoke":   {"active": "#00FF88", "inactive": "#FFFFFF", "contour": "#000000"},
    # CapCut highlighter (feutre jaune)
    "highlight": {"active": "#FFE566", "inactive": "#FFFFFF", "contour": "#000000"},
    # karaoke_neon ice
    "neon":      {"active": "#67E8F9", "inactive": "#94A3B8", "contour": "#020617"},
    # clean_lower_third : plaque sombre, mot actif ambre
    "boxed":     {"active": "#FBBF24", "inactive": "#FFFFFF", "contour": "#000000"},
    # podcast / clean
    "minimal":   {"active": "#FFFFFF", "inactive": "#FFFFFF", "contour": "#000000"},
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


# Whisper / VAD peuvent laisser un bloc collé 5s+ sur un silence → blanc gênant.
# Plafond d'affichage par bloc (après découpe en vrais mots).
_MAX_BLOCK_DISPLAY_SEC = 2.8


def expand_packed_words(words: list) -> list:
    """
    Si un 'mot' contient plusieurs tokens (reburn legacy / segments),
    le découpe avec timings proportionnels pour ne pas perdre de texte
    quand on plafonne la durée d'affichage.
    """
    out: list = []
    for w in words or []:
        text = str(w.get("word", "") or "").strip()
        if not text:
            continue
        tokens = text.split()
        ws = float(w.get("start", 0) or 0)
        we = float(w.get("end", ws + 0.1) or ws + 0.1)
        if len(tokens) <= 1:
            out.append({
                "word": tokens[0] if tokens else text,
                "start": ws,
                "end": max(ws + 0.04, we),
            })
            continue
        span = max(0.08, we - ws)
        step = span / len(tokens)
        for i, tok in enumerate(tokens):
            out.append({
                "word": tok,
                "start": ws + i * step,
                "end": ws + (i + 1) * step,
            })
    return out


# Si deux mots sont séparés par plus que ça, on coupe le bloc — sinon le prochain
# mot (encore non dit) s'affiche pendant le silence et "n'a rien à voir avec le son".
_MAX_WORD_GAP_IN_BLOCK = 0.65


def _make_subtitle_block(chunk: list, min_block_duration: float = 0.0) -> dict:
    bloc_end = float(chunk[-1]["end"])
    bloc_start = float(chunk[0]["start"])
    if min_block_duration > 0:
        # Prolonge un peu l'affichage, sans avaler un long silence (> gap).
        bloc_end = max(bloc_end, min(bloc_start + min_block_duration, bloc_end + 0.35))
    return {
        "words": chunk,
        "bloc_start": bloc_start,
        "bloc_end": bloc_end,
    }


def group_into_blocks(
    words: list,
    max_per_block: int = 4,
    min_block_duration: float = 0.0,
    max_gap: float = _MAX_WORD_GAP_IN_BLOCK,
) -> list:
    """
    Groupe les mots en blocs pour l'affichage.
    Coupe aussi sur un trou temporel (max_gap) — ne pas coller un mot futur
    dans le même cartouche pendant un blanc.
    """
    words = expand_packed_words(words)
    blocks: list = []
    cur: list = []
    for w in words:
        if not cur:
            cur = [w]
            continue
        gap = float(w.get("start", 0) or 0) - float(cur[-1].get("end", 0) or 0)
        if len(cur) >= max_per_block or gap > max_gap:
            blocks.append(_make_subtitle_block(cur, min_block_duration))
            cur = [w]
        else:
            cur.append(w)
    if cur:
        blocks.append(_make_subtitle_block(cur, min_block_duration))
    return blocks


def clamp_block_display_duration(
    blocks: list,
    max_sec: float = _MAX_BLOCK_DISPLAY_SEC,
) -> None:
    """
    Coupe les blocs trop longs (texte affiché pendant le silence).
    N'écrase pas une phrase encore parlée : le plafond s'applique au bloc
    déjà découpé en 2–3 mots (impact), pas à une phrase entière packée.
    """
    if not blocks or max_sec <= 0:
        return
    for b in blocks:
        s = float(b.get("bloc_start", 0) or 0)
        e = float(b.get("bloc_end", s) or s)
        if e - s <= max_sec:
            continue
        # Si le dernier mot démarre encore dans la fenêtre max, on garde jusqu'à
        # la fin de ce mot (+ petite grâce) pour ne pas couper au milieu d'un mot.
        words = b.get("words") or []
        last_start = max((float(w.get("start", s) or s) for w in words), default=s)
        last_end = max((float(w.get("end", s) or s) for w in words), default=e)
        if last_start <= s + max_sec:
            new_end = min(e, max(s + max_sec, min(last_end, s + max_sec + 0.6)))
        else:
            new_end = s + max_sec
        if new_end >= e - 0.01:
            continue
        b["bloc_end"] = new_end
        for w in words:
            ws = float(w.get("start", s) or s)
            we = float(w.get("end", ws) or ws)
            if ws >= new_end:
                # Mot entièrement hors fenêtre → collé en fin (évite mot orphelin)
                w["start"] = max(s, new_end - 0.08)
                w["end"] = new_end
            else:
                w["start"] = min(max(ws, s), max(s, new_end - 0.04))
                w["end"] = min(max(we, w["start"] + 0.04), new_end)


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


def bloc_for_display_at(bloc: dict | None, t: float, lead: float = 0.12) -> dict | None:
    """
    Ne montre que les mots déjà commencés (ou sur le point de l'être).
    Évite d'afficher un mot futur dans le même cartouche pendant que le son
    dit encore autre chose.
    """
    if not bloc:
        return None
    words = [
        w
        for w in (bloc.get("words") or [])
        if float(w.get("start", 0) or 0) <= t + lead
    ]
    if not words:
        return None
    return {
        "words": words,
        "bloc_start": float(bloc.get("bloc_start", words[0]["start"]) or 0),
        "bloc_end": float(bloc.get("bloc_end", words[-1]["end"]) or 0),
    }


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
    Recale les bornes d'affichage ET les timings mots (karaoké) sur l'activité vocale :
    - début : si le bloc démarre dans le silence, on le repousse au premier son
      (le texte n'apparaît plus avant que la parole commence) ;
    - fin : si le bloc se termine dans le silence, on le ramène juste après le
      dernier son (le texte ne reste plus affiché pendant un blanc) ;
    - mots : décalés du même delta que le début de bloc (Whisper souvent en avance).
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
        words = b.get("words") or []
        delta = 0.0
        # Début en avance sur la parole → repousser au premier son du bloc
        if not is_voiced_near(s):
            fv = first_voiced(s, min(e, s + lead_max))
            if fv is not None and fv > s:
                delta = min(fv, e - 0.1) - s
                b["bloc_start"] = s + delta
        # Fin qui traîne dans le silence → ramener au dernier son du bloc (+ petite grâce)
        if not is_voiced_near(e):
            lv = last_voiced(b["bloc_start"], e)
            if lv is not None and lv < e:
                b["bloc_end"] = max(b["bloc_start"] + 0.3, lv + 0.15)

        # Recaler le karaoké : même décalage de départ que le bloc (Whisper early).
        if abs(delta) > 0.01 and words:
            for w in words:
                w["start"] = max(0.0, float(w.get("start", 0) or 0) + delta)
                w["end"] = max(w["start"] + 0.04, float(w.get("end", 0) or 0) + delta)

        # Mot encore dans le silence (Whisper early intra-bloc) → pousser au prochain son.
        for w in words:
            ws = float(w.get("start", 0) or 0)
            we = float(w.get("end", ws + 0.1) or ws + 0.1)
            if is_voiced_near(ws, margin=0.08):
                continue
            fv = first_voiced(ws, min(we + lead_max, b["bloc_end"]))
            if fv is None or fv <= ws:
                continue
            shift = fv - ws
            w["start"] = ws + shift
            w["end"] = we + shift

        # Clamp dans les bornes du bloc
        if words:
            bloc_s, bloc_e = b["bloc_start"], b["bloc_end"]
            for w in words:
                w["start"] = min(max(float(w["start"]), bloc_s), max(bloc_s, bloc_e - 0.04))
                w["end"] = min(max(float(w["end"]), w["start"] + 0.04), bloc_e)

    # Les blocs ne doivent pas se chevaucher (min_block_duration peut étendre une fin
    # au-delà du début suivant) : le bloc suivant a priorité.
    for i in range(len(blocks) - 1):
        if blocks[i]["bloc_end"] > blocks[i + 1]["bloc_start"]:
            blocks[i]["bloc_end"] = blocks[i + 1]["bloc_start"]
            words = blocks[i].get("words") or []
            for w in words:
                w["end"] = min(w["end"], blocks[i]["bloc_end"])
                w["start"] = min(w["start"], max(0.0, w["end"] - 0.04))


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
    font_size = _scaled_px(80 if is_split else 96, width, 28)
    font_small = _scaled_px(66 if is_split else 78, width, 24)
    min_fs = _scaled_px(32, width, 18)
    min_sm = _scaled_px(26, width, 16)
    max_lines = 4
    min_line_h = _scaled_px(72, width, 36)

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
            line_height = max(int(font_size * 1.12), min_line_h)
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
    line_height = max(int(min_fs * 1.12), min_line_h)
    return lines, font, font_small_obj, line_height


# Position mono : ancre le bas du bloc texte.
# 0.63 (ancien) = milieu de frame → texte sur les visages en talking-head / duo.
# 0.78 = tiers bas, sous les têtes, encore au-dessus du chrome TikTok/Reels (~10% bas).
SAFE_BOTTOM_RATIO = 0.78
SAFE_CHROME_RATIO = 0.10
# Contour circulaire (MrBeast / CapCut) — plus lisible qu'un offset cardinal 3px.
OUTLINE_RADIUS = 6
OUTLINE_RADIUS_IMPACT = 10
ACTIVE_WORD_POP = 1.14
ACTIVE_WORD_POP_IMPACT = 1.14  # ≤1.14 sinon déborde du 9:16 avec stroke
# Marge latérale Impact : stroke + pop + ombre
IMPACT_EDGE_BLEED = OUTLINE_RADIUS_IMPACT + 16
# Karaoké : pilule serrée + gap large pour ne jamais chevaucher le voisin.
KARAOKE_PAD_X = 5
KARAOKE_PAD_Y = 8
KARAOKE_RADIUS = 10
KARAOKE_WORD_GAP = 24
KARAOKE_OUTLINE = 3
# CapCut highlighter (feutre)
HIGHLIGHT_PAD_X = 3
HIGHLIGHT_PAD_Y = 4
HIGHLIGHT_WORD_GAP = 20
# Plaque lower-third (ASS BorderStyle=3 vibe)
BOXED_PLATE_FILL = (0, 0, 0, 168)
BOXED_PLATE_BORDER = (255, 255, 255, 40)
BOXED_PLATE_SHADOW = (0, 0, 0, 100)
NEON_GLOW_BLUR = 18
NEON_GLOW_PASSES = 3
_OUTLINE_OFFSETS_CACHE: dict[int, list[tuple[int, int]]] = {}

# Typo calibrée pour export 1080 de large. Free 720p doit scaler sinon le texte mange le frame.
REF_SUBTITLE_WIDTH = 1080


def _subtitle_scale(width: int) -> float:
    w = int(width or REF_SUBTITLE_WIDTH)
    return max(0.55, min(1.15, w / float(REF_SUBTITLE_WIDTH)))


def _scaled_px(value: float | int, width: int, minimum: int = 1) -> int:
    return max(minimum, int(round(float(value) * _subtitle_scale(width))))


def _scale_font_ladder(sizes: list[int], width: int) -> list[int]:
    return [_scaled_px(v, width, 14) for v in sizes]


def _scale_font_pairs(pairs: list[tuple[int, int]], width: int) -> list[tuple[int, int]]:
    return [(_scaled_px(a, width, 14), _scaled_px(b, width, 12)) for a, b in pairs]

# Split 9:16 asymétrique (réf. interview) : primary en haut ~60%, secondary en bas ~40%.
SPLIT_TOP_H = 1152
SPLIT_BOTTOM_H = 768
SPLIT_SEPARATOR_PX = 4
# Sous-titres split : ancrés bas du panneau inférieur (sous le menton), pas sous le séparateur.
SPLIT_SUBTITLE_BOTTOM_RATIO = 0.88
# Gaming stack : seam cam / jeu. Keep in sync with stream_layout.STREAM_TOP_H.
STREAM_STACK_SEAM_Y = 900
# Zoom split : assez serré pour isoler chaque tête, sans manger les bords.
# 1.42 → ~37% de largeur source mais clamp dur dès qu'un visage est près du bord
# (visage coupé à gauche/droite). 1.26 → ~42%, isolation OK dès dist≈0.40.
SPLIT_FACE_ZOOM = 1.26
SPLIT_FACE_ZOOM_MIN = 1.08
# Mono 9:16 : zoom tête (sinon paysage = pleine hauteur → épaule/buste dominent).
MONO_FACE_ZOOM = 1.24
MONO_FACE_ZOOM_MIN = 1.0
# Yeux dans le tiers haut du 9:16 (pas au milieu → moins de torse).
MONO_EYE_Y_IN_FRAME = 0.36
# Marge normalisée (fraction frame source) autour du centre visage pour éviter
# qu'un clamp horizontal coupe la joue / le crâne.
SPLIT_FACE_EDGE_PAD = 0.055
# Écart horizontal mini entre centres top/bottom. Aligné sur le gate serveur
# (MIN_SPLIT_DIST≈0.38) : duo collé épaule-à-épaule → pas de positions split.
SPLIT_MIN_CENTER_SEP = 0.36
# Séparation "table / extrémités" : 2 personnes aux bords, souvent de 3/4 sans
# keypoints yeux fiables — quand même propice au split.
SPLIT_CLEAN_WIDE_SEP = 0.45
SPLIT_CLEAN_SOFT_SEP = 0.40
# Peau minimale dans le ROI de CHAQUE panneau avant d'armer un split.
# Mesuré sur le champ-contrechamp Economist/Elon : le pied de micro à gauche du
# cadre était détecté comme un visage AVEC keypoints yeux (has_eyes n'est donc
# pas fiable), aire comparable au vrai visage, à dist=0.45 → « wide_table » →
# split sur une personne seule (tête en bas, micro + épaule en haut).
# Marge énorme et sans ambiguïté : vrais visages 0.49-0.65, faux 0.00.
SPLIT_CLEAN_MIN_SKIN = 0.15


@dataclass(frozen=True)
class SplitClean:
    """Résultat externalisé : le plan source est-il propice au split ?"""

    clean: bool
    left: tuple[float, float] | None = None
    right: tuple[float, float] | None = None
    area_left: float = 0.0
    area_right: float = 0.0
    dist: float = 0.0
    eyes: int = 0
    skin_left: float = 0.0
    skin_right: float = 0.0
    reason: str = "none"

    @property
    def pair(
        self,
    ) -> tuple[tuple[float, float], tuple[float, float], float, float] | None:
        if not self.clean or self.left is None or self.right is None:
            return None
        return (self.left, self.right, self.area_left, self.area_right)


def assess_split_clean(frame: np.ndarray) -> SplitClean:
    """
    Check *externe* au rendu split : le plan est-il propice (clean) ?

    Règles (du plus clair au plus soft) :
    1) Séparation large (extrémités de table / face-à-face) → clean même sans yeux
    2) Séparation OK + ≥1 yeux → clean
    3) Séparation soft + aires comparables → clean (profils podcast)
    Sinon → pas clean (solo, collés, déséquilibrés).
    """
    try:
        faces = detect_all_faces_mp(
            frame,
            min_area_ratio=0.22,
            min_absolute_area=0.0028,
            min_horizontal_distance=0.16,
            # Pas de Haar ici : faux L/R (épaules) ouvraient le gate loose puis
            # le render retombait en mono seedé sur le torse.
            include_haar=False,
        )
    except Exception:
        return SplitClean(False, reason="detect_fail")
    if len(faces) < 2:
        return SplitClean(False, reason="solo")

    by_x = sorted(faces[:4], key=lambda f: f[0])
    left, right = by_x[0], by_x[-1]
    dist = float(abs(right[0] - left[0]))
    areas = sorted((left[2], right[2]), reverse=True)
    area_ok = areas[0] > 0 and areas[1] >= 0.30 * areas[0]
    eyes = int(sum(1 for f in (left, right) if f[3]))
    left_xy = (float(left[0]), float(left[1]))
    right_xy = (float(right[0]), float(right[1]))
    skin_left = _face_roi_skin_score(frame, left[0], left[1], left[2])
    skin_right = _face_roi_skin_score(frame, right[0], right[1], right[2])
    base = dict(
        left=left_xy,
        right=right_xy,
        area_left=float(left[2]),
        area_right=float(right[2]),
        dist=dist,
        eyes=eyes,
        skin_left=float(skin_left),
        skin_right=float(skin_right),
    )

    # Chaque panneau du split doit contenir un VRAI visage. `has_eyes` ne suffit
    # pas : BlazeFace renvoie des keypoints yeux sur un pied de micro. La peau,
    # elle, sépare sans ambiguïté (vrais visages ≥0.49, décor 0.00).
    if min(skin_left, skin_right) < SPLIT_CLEAN_MIN_SKIN:
        return SplitClean(False, reason="no_skin", **base)
    if not area_ok:
        return SplitClean(False, reason="unbalanced", **base)
    if dist < SPLIT_MIN_CENTER_SEP:
        return SplitClean(False, reason="too_close", **base)

    # 1) Table / extrémités : très propice, profils OK sans yeux
    if dist >= SPLIT_CLEAN_WIDE_SEP:
        return SplitClean(True, reason="wide_table", **base)
    # 2) Séparation classique + yeux
    if eyes >= 1:
        return SplitClean(True, reason="eyes_ok", **base)
    # 3) Soft : encore assez écartés (face-à-face un peu moins large)
    if dist >= SPLIT_CLEAN_SOFT_SEP:
        return SplitClean(True, reason="soft_sep", **base)

    return SplitClean(False, reason="need_eyes_or_wider", **base)


def _clear_two_shot_pair(
    frame: np.ndarray,
    *,
    require_eyes: bool = True,
    min_eyes: int = 1,
) -> tuple[tuple[float, float], tuple[float, float], float, float] | None:
    """Compat : délègue à assess_split_clean (check propice externalisé)."""
    _ = (require_eyes, min_eyes)  # legacy kwargs — le clean gère yeux vs wide_table
    return assess_split_clean(frame).pair


def source_has_clear_two_shot(frame: np.ndarray) -> bool:
    """True si le plan est clean / propice au split."""
    return assess_split_clean(frame).clean


def is_split_clean_frame(frame: np.ndarray) -> bool:
    """Alias explicite : frame propice au split (check externalisé)."""
    return assess_split_clean(frame).clean


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def _safe_y_base(height: int, content_h: int, layout_mode: str = "normal") -> int:
    if layout_mode == "stream_stack":
        # Center the block on the facecam / gameplay seam (don't cover mid-game).
        # STREAM_STACK_SEAM_Y is defined for 1920-tall output — scale with height.
        seam_ref = int(round(STREAM_STACK_SEAM_Y * (height / 1920.0))) if height > 0 else height // 2
        seam = seam_ref if height >= seam_ref + 32 else height // 2
        y = int(seam - content_h / 2)
        return max(0, min(y, height - content_h))
    if layout_mode == "split_vertical":
        # Bas du panneau inférieur, sous le menton — le bloc grandit vers le haut
        # depuis cette ancre (y = bottom - content_h).
        scale = height / 1920.0 if height > 0 else 1.0
        bottom_panel_top = int(round((SPLIT_TOP_H + SPLIT_SEPARATOR_PX) * scale))
        y = int(height * SPLIT_SUBTITLE_BOTTOM_RATIO) - content_h
        # Rester dans le panneau bas, avec une petite marge.
        y = max(bottom_panel_top + 24, min(y, height - content_h - 16))
        return y
    # Bas du bloc ≈ SAFE_BOTTOM_RATIO ; clamp pour ne jamais manger le chrome bas.
    bottom_limit = int(height * (1.0 - SAFE_CHROME_RATIO))
    y = int(height * SAFE_BOTTOM_RATIO) - content_h
    if y + content_h > bottom_limit:
        y = bottom_limit - content_h
    return max(0, min(y, max(0, height - content_h)))



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
    # Clamp dans le canvas (évite crop silencieux hors frame)
    paste_x = max(0, min(paste_x, img.width - new_w))
    paste_y = max(0, min(paste_y, img.height - new_h))
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
    """Impact : 2 mots par bloc, très grands. Mot actif jaune + pop, stroke épais."""
    colors = STYLE_COLORS.get(style, STYLE_COLORS["impact"])
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    words_data = bloc.get("words", [])
    if not words_data:
        return np.array(img)

    is_split = layout_mode == "split_vertical"
    # Marge large : le pop + stroke débordent hors de la bbox texte
    margin_x = int(width * 0.09) + IMPACT_EDGE_BLEED
    max_line_w = max(80, width - 2 * margin_x)
    active_rgb = _hex_to_rgb(colors["active"])
    contour_rgb = _hex_to_rgb(colors["contour"])

    # Budget utile après inflation pop (mot actif en bord de ligne)
    fit_budget = max_line_w / ACTIVE_WORD_POP_IMPACT

    # Auto-scale : réduire la police jusqu'à ce que la ligne + bleed rentrent
    font = None
    line_h = 0
    lines: list[list[dict]] = []
    size_ladder = [88, 76, 64, 54, 44, 36] if is_split else [120, 104, 88, 76, 64, 52]
    for font_size in size_ladder:
        font = _load_title_font(font_path, font_size)
        line_h = int(font_size * 1.28)

        lines = []
        cur: list[dict] = []
        cur_w = 0.0
        for w in words_data:
            word_w = _textlength(draw, w["word"] + " ", font)
            if cur and cur_w + word_w > fit_budget + 1:
                lines.append(cur)
                cur = [w]
                cur_w = word_w
            else:
                cur.append(w)
                cur_w += word_w
        if cur:
            lines.append(cur)

        fits = all(
            _textlength(draw, " ".join(w["word"] for w in line), font) <= fit_budget
            for line in lines
        )
        if fits:
            break

    # Hauteur : réserve stroke bas
    total_h = len(lines) * line_h + OUTLINE_RADIUS_IMPACT
    y_base = _safe_y_base(height, total_h, layout_mode)
    y_base = max(OUTLINE_RADIUS_IMPACT + 4, y_base)

    for line_words in lines:
        line_text_w = _textlength(draw, " ".join(w["word"] for w in line_words), font)
        x = (width - line_text_w) / 2
        # Sécurité horizontale si arrondi / pop
        x = max(margin_x * 0.35, min(x, width - line_text_w - margin_x * 0.35))

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
                pop=ACTIVE_WORD_POP_IMPACT if is_active else 1.0,
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
    """Plaque lower-third : capsule noire semi-opaque + mot actif ambre (broadcast)."""
    colors = STYLE_COLORS.get(style, STYLE_COLORS["boxed"])
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    is_split = layout_mode == "split_vertical"
    words_data = bloc.get("words", [])
    if not words_data:
        return np.array(img)

    lines, font, font_small_obj, line_height = _layout_subtitle_lines(
        words_data, width, font_path, is_split, draw
    )
    n_lines = len(lines)
    y_base = _safe_y_base(height, line_height * n_lines, layout_mode)

    max_line_w = max(
        (_line_width_total(draw, line, font, font_small_obj) for line in lines),
        default=0,
    )

    pad_x, pad_y, box_radius = 30, 16, 12
    box_x1 = (width - max_line_w) / 2 - pad_x
    box_y1 = y_base - pad_y
    box_x2 = (width + max_line_w) / 2 + pad_x
    box_y2 = y_base + line_height * n_lines + pad_y * 0.45

    shadow_off = 8
    draw.rounded_rectangle(
        [box_x1 + 1, box_y1 + shadow_off, box_x2 + 1, box_y2 + shadow_off],
        radius=box_radius,
        fill=BOXED_PLATE_SHADOW,
    )
    draw.rounded_rectangle(
        [box_x1, box_y1, box_x2, box_y2],
        radius=box_radius,
        fill=BOXED_PLATE_FILL,
        outline=BOXED_PLATE_BORDER,
        width=1,
    )

    active_rgb = _hex_to_rgb(colors["active"])
    inactive_rgb = _hex_to_rgb(colors["inactive"])

    for line_idx, line_words in enumerate(lines):
        line_width = _line_width_total(draw, line_words, font, font_small_obj)
        x = (width - line_width) / 2
        y = y_base + line_idx * line_height

        for word_obj in line_words:
            word = word_obj["word"]
            is_active = _is_active_word(word_obj, active_word)
            f = font_small_obj if len(word) > 10 else font
            fill = (*active_rgb, 255) if is_active else (*inactive_rgb, 255)
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


def _render_karaoke_frame(
    width: int,
    height: int,
    bloc: dict,
    active_word: dict | None,
    style: str,
    font_path: str,
    layout_mode: str = "normal",
) -> np.ndarray:
    """Karaoké : pilule serrée sur le mot actif, gap large pour éviter le chevauchement."""
    colors = STYLE_COLORS.get(style, STYLE_COLORS["karaoke"])
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    words_data = bloc.get("words", [])
    if not words_data:
        return np.array(img)

    is_split = layout_mode == "split_vertical"
    margin_x = int(width * 0.08)
    max_line_w = width - 2 * margin_x
    active_rgb = _hex_to_rgb(colors["active"])
    inactive_rgb = _hex_to_rgb(colors["inactive"])
    contour_rgb = _hex_to_rgb(colors["contour"])

    def word_advance(w: str, f) -> float:
        return _textlength(draw, w, f) + KARAOKE_WORD_GAP

    font = None
    font_small_obj = None
    line_h = 0
    lines: list[list[dict]] = []
    for font_size, font_small in (
        ([80, 66] if is_split else [96, 78]),
        ([72, 60] if is_split else [84, 70]),
        ([64, 54] if is_split else [72, 60]),
        ([56, 48] if is_split else [60, 50]),
    ):
        font = _load_title_font(font_path, font_size)
        font_small_obj = _load_title_font(font_path, font_small)
        line_h = max(int(font_size * 1.28), 72)
        lines = []
        cur: list[dict] = []
        cur_w = 0.0
        for w in words_data:
            word = w["word"]
            f = font_small_obj if len(word) > 10 else font
            adv = word_advance(word, f)
            if cur and cur_w + adv > max_line_w + 1:
                lines.append(cur)
                cur = [w]
                cur_w = adv
            else:
                cur.append(w)
                cur_w += adv
        if cur:
            lines.append(cur)
        widest = 0.0
        for line in lines:
            lw = sum(
                word_advance(w["word"], font_small_obj if len(w["word"]) > 10 else font)
                for w in line
            )
            # Dernier mot : pas de gap trailing pour le centrage
            if line:
                last = line[-1]["word"]
                lf = font_small_obj if len(last) > 10 else font
                lw -= KARAOKE_WORD_GAP
                lw = max(lw, _textlength(draw, last, lf))
            widest = max(widest, lw)
        if widest <= max_line_w and len(lines) <= 4:
            break

    n_lines = len(lines)
    y_base = _safe_y_base(height, line_h * n_lines, layout_mode)

    for line_idx, line_words in enumerate(lines):
        line_w = 0.0
        advances: list[float] = []
        fonts_line: list = []
        for w in line_words:
            word = w["word"]
            f = font_small_obj if len(word) > 10 else font
            fonts_line.append(f)
            adv = word_advance(word, f)
            advances.append(adv)
            line_w += adv
        if line_words:
            line_w -= KARAOKE_WORD_GAP

        x = (width - line_w) / 2
        y = y_base + line_idx * line_h

        for i, word_obj in enumerate(line_words):
            word = word_obj["word"]
            f = fonts_line[i]
            is_active = _is_active_word(word_obj, active_word)
            glyph_w = _textlength(draw, word, f)

            if is_active:
                bbox = draw.textbbox((x, y), word, font=f)
                draw.rounded_rectangle(
                    [
                        bbox[0] - KARAOKE_PAD_X,
                        bbox[1] - KARAOKE_PAD_Y,
                        bbox[2] + KARAOKE_PAD_X,
                        bbox[3] + KARAOKE_PAD_Y,
                    ],
                    radius=KARAOKE_RADIUS,
                    fill=(*active_rgb, 255),
                )
                # Texte noir sans contour — propre sur la pilule (pas blanc+stroke)
                draw.text((x, y), word, font=f, fill=(10, 10, 10, 255))
            else:
                _draw_outlined_text(
                    draw,
                    (x, y),
                    word,
                    f,
                    (*inactive_rgb, 255),
                    contour_rgb,
                    OUTLINE_RADIUS,
                    shadow=True,
                )

            x += glyph_w + KARAOKE_WORD_GAP

    return np.array(img)


def _render_marker_frame(
    width: int,
    height: int,
    bloc: dict,
    active_word: dict | None,
    style: str,
    font_path: str,
    layout_mode: str = "normal",
) -> np.ndarray:
    """CapCut highlighter : feutre jaune serré derrière le mot, texte noir, gap anti-bleed."""
    colors = STYLE_COLORS.get(style, STYLE_COLORS["highlight"])
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    is_split = layout_mode == "split_vertical"
    words_data = bloc.get("words", [])
    if not words_data:
        return np.array(img)

    active_rgb = _hex_to_rgb(colors["active"])
    inactive_rgb = _hex_to_rgb(colors["inactive"])
    contour_rgb = _hex_to_rgb(colors["contour"])
    margin_x = int(width * 0.08)
    max_line_w = width - 2 * margin_x

    def word_advance(w: str, f) -> float:
        return _textlength(draw, w, f) + HIGHLIGHT_WORD_GAP

    font = None
    font_small_obj = None
    line_h = 0
    lines: list[list[dict]] = []
    for font_size, font_small in (
        ([80, 66] if is_split else [92, 76]),
        ([72, 60] if is_split else [80, 66]),
        ([64, 54] if is_split else [68, 56]),
        ([56, 48] if is_split else [56, 48]),
    ):
        font = _load_title_font(font_path, font_size)
        font_small_obj = _load_title_font(font_path, font_small)
        line_h = max(int(font_size * 1.3), 70)
        lines = []
        cur: list[dict] = []
        cur_w = 0.0
        for w in words_data:
            word = w["word"]
            f = font_small_obj if len(word) > 10 else font
            adv = word_advance(word, f)
            if cur and cur_w + adv > max_line_w + 1:
                lines.append(cur)
                cur = [w]
                cur_w = adv
            else:
                cur.append(w)
                cur_w += adv
        if cur:
            lines.append(cur)
        widest = 0.0
        for line in lines:
            lw = sum(
                word_advance(w["word"], font_small_obj if len(w["word"]) > 10 else font)
                for w in line
            )
            if line:
                lw -= HIGHLIGHT_WORD_GAP
            widest = max(widest, lw)
        if widest <= max_line_w and len(lines) <= 4:
            break

    y_base = _safe_y_base(height, line_h * len(lines), layout_mode)

    for line_idx, line_words in enumerate(lines):
        line_w = sum(
            word_advance(w["word"], font_small_obj if len(w["word"]) > 10 else font)
            for w in line_words
        )
        if line_words:
            line_w -= HIGHLIGHT_WORD_GAP
        x = (width - line_w) / 2
        y = y_base + line_idx * line_h

        for word_obj in line_words:
            word = word_obj["word"]
            f = font_small_obj if len(word) > 10 else font
            is_active = _is_active_word(word_obj, active_word)
            glyph_w = _textlength(draw, word, f)

            if is_active:
                bbox = draw.textbbox((x, y), word, font=f)
                # Feutre rectangulaire serré (pas une pilule ronde)
                draw.rectangle(
                    [
                        bbox[0] - HIGHLIGHT_PAD_X,
                        bbox[1] - HIGHLIGHT_PAD_Y,
                        bbox[2] + HIGHLIGHT_PAD_X,
                        bbox[3] + HIGHLIGHT_PAD_Y,
                    ],
                    fill=(*active_rgb, 230),
                )
                draw.text((x, y), word, font=f, fill=(15, 15, 15, 255))
            else:
                _draw_outlined_text(
                    draw, (x, y), word, f, (*inactive_rgb, 255),
                    contour_rgb, OUTLINE_RADIUS, shadow=True,
                )
            x += glyph_w + HIGHLIGHT_WORD_GAP

    return np.array(img)


def _composite_neon_glow(
    img: Image.Image,
    x: float,
    y: float,
    word: str,
    font,
    glow_rgb: tuple[int, int, int],
) -> None:
    """Lueur floue premium sous le glyphe (pas de halo en croix cheap)."""
    bbox = ImageDraw.Draw(img).textbbox((0, 0), word, font=font)
    tw = max(1, bbox[2] - bbox[0])
    th = max(1, bbox[3] - bbox[1])
    pad = NEON_GLOW_BLUR * 3 + 8
    tmp = Image.new("RGBA", (tw + pad * 2, th + pad * 2), (0, 0, 0, 0))
    td = ImageDraw.Draw(tmp)
    ox = pad - bbox[0]
    oy = pad - bbox[1]
    # Couche glow saturée
    td.text((ox, oy), word, font=font, fill=(*glow_rgb, 240))
    glow = tmp
    for _ in range(NEON_GLOW_PASSES):
        glow = glow.filter(ImageFilter.GaussianBlur(NEON_GLOW_BLUR))
    # Renforce un peu le cœur du glow
    core = Image.new("RGBA", tmp.size, (0, 0, 0, 0))
    ImageDraw.Draw(core).text((ox, oy), word, font=font, fill=(*glow_rgb, 200))
    core = core.filter(ImageFilter.GaussianBlur(max(5, NEON_GLOW_BLUR // 2)))
    glow = Image.alpha_composite(glow, core)

    paste_x = int(round(x - pad + bbox[0]))
    paste_y = int(round(y - pad + bbox[1]))
    img.alpha_composite(glow, (paste_x, paste_y))


def _render_glow_frame(
    width: int,
    height: int,
    bloc: dict,
    active_word: dict | None,
    style: str,
    font_path: str,
    layout_mode: str = "normal",
) -> np.ndarray:
    """Néon : mot actif blanc + lueur cyan floue ; inactifs discrets avec contour fin."""
    colors = STYLE_COLORS.get(style, STYLE_COLORS["neon"])
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    is_split = layout_mode == "split_vertical"
    words_data = bloc.get("words", [])
    if not words_data:
        return np.array(img)

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

            if is_active:
                _composite_neon_glow(img, x, y, word, f, active_rgb)
                # Redessiner le draw après alpha_composite (même image)
                draw = ImageDraw.Draw(img)
                _draw_outlined_text(
                    draw, (x, y), word, f, (255, 255, 255, 255),
                    outline_rgb=contour_rgb, outline_radius=2, shadow=False,
                )
                draw.text((x, y), word, font=f, fill=(240, 250, 255, 255))
                x += _textlength(draw, word + " ", f)
            else:
                x += _draw_word(
                    draw, img, x, y, word, f, (*inactive_rgb, 210),
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
    """Simple / podcast : texte blanc uniforme, pas de highlight ni d'animation mot à mot."""
    del active_word  # intentionnel : aucun mot actif
    colors = STYLE_COLORS.get(style, STYLE_COLORS["minimal"])
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    is_split = layout_mode == "split_vertical"
    words_data = bloc.get("words", [])
    if not words_data:
        return np.array(img)

    # Police un cran plus petite que le karaoké — caption discrète
    margin_x = int(width * 0.09)
    max_line_w = width - 2 * margin_x
    fill_rgb = _hex_to_rgb(colors.get("inactive") or colors.get("active") or "#FFFFFF")
    contour_rgb = _hex_to_rgb(colors.get("contour") or "#000000")

    font = None
    line_h = 0
    lines: list[list[dict]] = []
    size_ladder = [72, 64, 56, 48, 40] if is_split else [78, 68, 58, 50, 42]
    for font_size in size_ladder:
        font = _load_title_font(font_path, font_size)
        line_h = max(int(font_size * 1.3), 56)
        lines = []
        cur: list[dict] = []
        cur_w = 0.0
        for w in words_data:
            word = w["word"]
            adv = _textlength(draw, word + " ", font)
            if cur and cur_w + adv > max_line_w + 1:
                lines.append(cur)
                cur = [w]
                cur_w = adv
            else:
                cur.append(w)
                cur_w += adv
        if cur:
            lines.append(cur)
        fits = all(
            _textlength(draw, " ".join(w["word"] for w in line), font) <= max_line_w
            for line in lines
        )
        if fits and len(lines) <= 4:
            break

    y_base = _safe_y_base(height, line_h * len(lines), layout_mode)
    for line_idx, line_words in enumerate(lines):
        line_text = " ".join(w["word"] for w in line_words)
        line_w = _textlength(draw, line_text, font)
        x = (width - line_w) / 2
        y = y_base + line_idx * line_h
        _draw_outlined_text(
            draw,
            (x, y),
            line_text,
            font,
            (*fill_rgb, 255),
            contour_rgb,
            outline_radius=3,
            shadow=True,
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
    # pill (karaoke / ocean / berry)
    return _render_karaoke_frame(width, height, bloc, active_word, style, font_path, layout_mode)


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


HOOK_DURATION_DEFAULT = 3.0
HOOK_FADE_IN = 0.12
HOOK_FADE_OUT = 0.28


def _wrap_plain_text(text: str, draw, font, max_width: float) -> list[str]:
    words = text.split()
    if not words:
        return []
    lines: list[str] = []
    current = words[0]
    for w in words[1:]:
        trial = f"{current} {w}"
        if _textlength(draw, trial, font) <= max_width:
            current = trial
        else:
            lines.append(current)
            current = w
    lines.append(current)
    return lines


def _hook_opacity(t: float, duration: float) -> float:
    if t < 0 or t >= duration:
        return 0.0
    if t < HOOK_FADE_IN:
        return t / HOOK_FADE_IN
    remaining = duration - t
    if remaining < HOOK_FADE_OUT:
        return max(0.0, remaining / HOOK_FADE_OUT)
    return 1.0


def render_hook_title_card(
    width: int,
    height: int,
    text: str,
    font_path: str,
) -> np.ndarray | None:
    """Bandeau putaclic style TikTok : texte noir gras sur fond blanc arrondi, tiers haut."""
    text = filter_emojis((text or "").strip())
    if not text:
        return None

    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    max_box_w = int(width * 0.90)
    pad_x = int(width * 0.042)
    pad_y = int(height * 0.016)
    inner_max = max_box_w - 2 * pad_x

    best_font = None
    best_lines: list[str] = [text]
    # Gros titre (~8.5% → 4.5% de la largeur) ; viser 1–2 lignes, max 3
    for fs in range(int(width * 0.082), int(width * 0.042) - 1, -2):
        font = _load_title_font(font_path, fs)
        lines = _wrap_plain_text(text, draw, font, inner_max)
        if len(lines) <= 2:
            best_font, best_lines = font, lines
            break
        if len(lines) == 3 and best_font is None:
            best_font, best_lines = font, lines
    if best_font is None:
        best_font = _load_title_font(font_path, int(width * 0.048))
        best_lines = _wrap_plain_text(text, draw, best_font, inner_max)

    line_metrics = []
    max_line_w = 0
    line_h = 0
    for line in best_lines:
        bbox = draw.textbbox((0, 0), line, font=best_font)
        lw = bbox[2] - bbox[0]
        lh = bbox[3] - bbox[1]
        line_metrics.append((lw, lh, bbox))
        max_line_w = max(max_line_w, lw)
        line_h = max(line_h, lh)

    gap = max(4, int(line_h * 0.14))
    text_block_h = line_h * len(best_lines) + gap * max(0, len(best_lines) - 1)
    box_w = min(max_box_w, max_line_w + 2 * pad_x)
    box_h = text_block_h + 2 * pad_y
    box_x = (width - box_w) / 2
    # Position screenshot : haut du cadre, au-dessus du visage
    box_y = height * (0.12 if height >= width else 0.10)
    radius = max(10, int(min(box_h * 0.28, width * 0.028)))

    draw.rounded_rectangle(
        [box_x, box_y, box_x + box_w, box_y + box_h],
        radius=radius,
        fill=(255, 255, 255, 250),
    )

    y = box_y + pad_y
    for i, line in enumerate(best_lines):
        lw, _lh, bbox = line_metrics[i]
        x = box_x + (box_w - lw) / 2 - bbox[0]
        draw.text((x, y - bbox[1]), line, font=best_font, fill=(0, 0, 0, 255))
        y += line_h + gap

    return np.array(img)


def _scale_overlay_alpha(overlay_rgba: np.ndarray, mul: float) -> np.ndarray:
    if mul >= 0.999:
        return overlay_rgba
    out = overlay_rgba.copy()
    out[:, :, 3] = (out[:, :, 3].astype(np.float32) * mul).astype(np.uint8)
    return out


def apply_hook_title_if_needed(
    frame: np.ndarray,
    t: float,
    hook_overlay: np.ndarray | None,
    hook_bbox: tuple[int, int, int, int] | None,
    hook_duration: float,
) -> np.ndarray:
    if hook_overlay is None or hook_bbox is None:
        return frame
    opacity = _hook_opacity(t, hook_duration)
    if opacity <= 0.01:
        return frame
    return blend_overlay(frame, _scale_overlay_alpha(hook_overlay, opacity), hook_bbox)


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


def _face_roi_skin_score(frame: np.ndarray, cx: float, cy: float, area: float) -> float:
    """
    Score 0–1 : proportion de pixels type peau dans le bbox approximatif.
    Un micro noir / bras de boom score ~0 → on peut le rejeter.
    """
    h, w = frame.shape[:2]
    if h < 8 or w < 8:
        return 0.0
    half = max(0.04, min(0.18, 0.55 * (max(area, 0.004) ** 0.5)))
    x0 = max(0, int((cx - half) * w))
    x1 = min(w, int((cx + half) * w))
    y0 = max(0, int((cy - half) * h))
    y1 = min(h, int((cy + half * 0.9) * h))
    if x1 - x0 < 4 or y1 - y0 < 4:
        return 0.0
    roi = frame[y0:y1, x0:x1]
    if roi.size == 0:
        return 0.0
    # ROI trop sombre = micro / boom (pas un visage éclairé interview).
    mean_v = float(np.mean(roi))
    if mean_v < 28.0:
        return 0.0
    ycrcb = cv2.cvtColor(roi, cv2.COLOR_BGR2YCrCb)
    # Plage peau large (studio froid/chaud).
    skin = cv2.inRange(ycrcb, (0, 133, 77), (255, 173, 127))
    return float(np.count_nonzero(skin)) / float(skin.size)


def _score_face_candidate(
    frame: np.ndarray,
    cx: float,
    cy: float,
    area: float,
    prefer_cx: float | None = None,
    has_eyes: bool = False,
) -> float:
    """Score pour choisir la vraie tête (vs micro / épaule / main).

    Priorité : yeux confirmés > grande aire MediaPipe + cy tête.
    Peau = bonus soft (pas un hard-reject agressif — sinon profil / lumière
    froide = mauvais lock).
    """
    # Sans yeux, un cy bas = souvent torse/épaule. Avec yeux, on accepte assis/table.
    if has_eyes:
        if cy > _FACE_MAX_CY_EYES:
            return -1.0
    elif cy > _FACE_MAX_CY:
        return -1.0
    skin = _face_roi_skin_score(frame, cx, cy, area)
    # Reject uniquement petits blobs très sombres (micro boom).
    if area < 0.015 and skin < 0.03 and not has_eyes:
        return -1.0
    # Aire domine ; yeux = très fort bonus (tête réelle vs épaule/objet).
    score = area * 20.0 + skin * 1.2 + (0.52 - cy) * 1.5
    if has_eyes:
        score += 6.5
    else:
        # Sans yeux : souvent bbox dérivée vers joue/épaule — on défavorise.
        score -= 2.5
    if prefer_cx is not None:
        # Continuité : rester sur la même tête quand 2–3 personnes sont collées.
        score -= abs(cx - prefer_cx) * 1.2
    # Pénalité douce du centre mort (podcast 2 personnes = vide / micro).
    if 0.42 <= cx <= 0.58 and not has_eyes:
        score -= 1.5
    return score


def detect_face_center(
    frame: np.ndarray,
    prefer_cx: float | None = None,
    require_eyes: bool = False,
) -> tuple[float, float] | None:
    """Wrapper : centre du meilleur visage, ou None."""
    scored = detect_face_center_scored(
        frame, prefer_cx=prefer_cx, require_eyes=require_eyes
    )
    if scored is None:
        return None
    return (scored[0], scored[1])


def detect_face_center_scored(
    frame: np.ndarray,
    prefer_cx: float | None = None,
    require_eyes: bool = False,
) -> tuple[float, float, float, float] | None:
    """
    Détecte le visage principal. Retourne (cx, cy, score, area) ou None.

    MediaPipe d'abord (ancre yeux si keypoints) ; Haar seulement si MP vide.
    `require_eyes=True` : refuse les candidats sans keypoints yeux (pré-pass mono).
    """
    # (cx, cy, area, has_eyes)
    candidates: list[tuple[float, float, float, bool]] = []

    # 1. MediaPipe (sans Haar — les micros boom noirs passent trop souvent en Haar)
    try:
        faces = detect_all_faces_mp(
            frame,
            min_area_ratio=0.28,
            min_absolute_area=0.004,
            include_haar=False,
        )
        for cx, cy, area, has_eyes in faces:
            candidates.append((cx, cy, area, has_eyes))
    except Exception:
        pass

    # 2. Haar seulement si MP n'a rien (jamais en mode require_eyes)
    if not candidates and not require_eyes:
        try:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            h, w = frame.shape[:2]
            frontal = _get_frontal_cascade()
            if frontal is not None:
                pos = _detect_with_cascade(frontal, gray, w, h)
                if pos is not None:
                    candidates.append((pos[0], pos[1], 0.02, False))
            profile = _get_profile_cascade()
            if profile is not None and not candidates:
                pos = _detect_with_cascade(profile, gray, w, h)
                if pos is not None:
                    candidates.append((pos[0], pos[1], 0.02, False))
                else:
                    flipped = cv2.flip(gray, 1)
                    pos = _detect_with_cascade(profile, flipped, w, h)
                    if pos is not None:
                        candidates.append((1.0 - pos[0], pos[1], 0.02, False))
        except Exception:
            pass

    scored: list[tuple[float, float, float, float]] = []
    for cx, cy, area, has_eyes in candidates:
        if require_eyes and not has_eyes:
            continue
        sc = _score_face_candidate(
            frame, cx, cy, area, prefer_cx=prefer_cx, has_eyes=has_eyes
        )
        if sc >= 0.0:
            scored.append((sc, cx, cy, area))
    if not scored:
        return None
    scored.sort(key=lambda t: -t[0])
    # 2-shot clair : ancre sur UNE tête (jamais le milieu entre les deux).
    if len(scored) >= 2 and abs(scored[0][1] - scored[1][1]) > 0.35:
        if prefer_cx is not None:
            chosen = min(scored[:2], key=lambda t: abs(t[1] - prefer_cx))
            return (chosen[1], chosen[2], chosen[0], chosen[3])
        return (scored[0][1], scored[0][2], scored[0][0], scored[0][3])
    return (scored[0][1], scored[0][2], scored[0][0], scored[0][3])


_DETECT_INTERVAL: int = int(os.environ.get("SMART_CROP_DETECT_INTERVAL", "15"))
# Pré-pass plus dense : mieux vérifier la tête avant de figer.
_PREFLIGHT_INTERVAL: int = max(8, _DETECT_INTERVAL // 2)
_SMART_CROP_MAX_WIDTH: int = int(os.environ.get("SMART_CROP_MAX_WIDTH", "0")) or 0
# Détection de plan. L'ancien couple (0.34, debounce=2) ne détectait AUCUNE coupe
# franche : un cut ne produit qu'UNE paire de frames très différentes (exiger 2
# paires consécutives ne repère que les fondus), et 0.34 de différence absolue
# moyenne correspond à un passage noir→blanc — mesuré, une vraie coupe donne
# ~0.10-0.20. Résultat : tout le clip formait un seul plan avec un seul lock,
# donc un cadrage figé sur la mauvaise personne après un cut → « personne coupée ».
# Sur-segmenter est bénin (le lock est simplement recalculé, et la fusion
# _MIN_SHOT_SEC + _LOCK_JUMP_REJECT absorbe le bruit) ; sous-segmenter ne l'est pas.
_SCENE_CUT_THRESHOLD: float = 0.10
# …ou 3× le mouvement courant : sur un plan très agité, il faut un vrai pic.
_SCENE_CUT_REL: float = 3.0
# Évite de compter deux fois une transition étalée sur 2-3 frames.
_SCENE_CUT_MIN_GAP: int = 3
_PROGRESS_LOG_FRAMES = 200
_DEFAULT_CX: float = 0.5
_DEFAULT_CY: float = 0.38
# Ancre verticale : assez haute pour talking-head, assez basse pour assis/table.
_CY_CLAMP = (0.20, 0.46)
_FACE_MAX_CY: float = 0.52
_FACE_MAX_CY_EYES: float = 0.60
_PREFLIGHT_MIN_EYE_SAMPLES: int = 3
# Mini-plans (faux cuts) → flash de mauvais cadrage. Fusionner sous ~0.45s.
_MIN_SHOT_SEC: float = 0.45
# Ignore un nouveau lock s'il saute trop vs le précédent sur un plan court.
_LOCK_JUMP_REJECT: float = 0.22
# Lock sans keypoints yeux : accepté sur un plan long seulement si la détection
# est stable (dispersion horizontale faible) et bien notée. Sinon on tient le
# lock précédent — un micro boom / une chaise ne reste pas stable 1s d'affilée.
_WEAK_LOCK_MAX_SPREAD: float = 0.10
_WEAK_LOCK_MIN_SAMPLES: int = 3
# Échelle de _score_face_candidate : aire×20 + peau×1.2 + (0.52−cy)×1.5.
# Un vrai visage (aire 0.02, peau 0.4, cy 0.35) ≈ 1.1 ; un blob mat centré est
# déjà rejeté en amont (pénalité centre mort −1.5 → score < 0).
_WEAK_LOCK_MIN_SCORE: float = 0.9
# Re-lock tête dans un long plan (évite 15–20s figés sur une épaule).
_LOCK_WINDOW_SEC: float = 2.8
# Soft ease entre locks mono (intra-plan seulement). MONO_LOCK_EASE=0 → freeze exact.
def _env_flag_on(name: str, default: bool = True) -> bool:
    raw = os.environ.get(name)
    if raw is None or str(raw).strip() == "":
        return default
    return str(raw).strip().lower() not in ("0", "false", "off", "no")


# Sous ce delta : ne pas bouger du tout (bruit / micro-mouvement).
_MONO_LOCK_EASE_DEADZONE: float = 0.025
# Plafond de vitesse très bas (~0.018/s @30fps) — le cadre ne « chasse » pas.
_MONO_LOCK_EASE_MAX_STEP: float = 0.0006
# Blend lent vers la cible après clamp max_step.
_MONO_LOCK_EASE_EMA: float = 0.98


def _fill_mono_lock_window(
    cx_smooth: np.ndarray,
    cy_smooth: np.ndarray,
    zoom_smooth: np.ndarray,
    ws: int,
    we: int,
    lock_cx: float,
    lock_cy: float,
    zoom: float,
    *,
    soft: bool,
    snap: bool,
    start_cx: float | None,
    start_cy: float | None,
) -> tuple[float, float]:
    """Écrit le crop sur [ws:we). Zoom toujours figé. Soft = ease lent vers le lock.

    snap=True (1ère fenêtre d'un plan / cut) → freeze exact comme l'ancien modèle.
    Retourne la position affichée en fin de fenêtre (pour enchaîner l'ease).
    """
    zoom_smooth[ws:we] = zoom
    if (
        snap
        or not soft
        or start_cx is None
        or start_cy is None
    ):
        cx_smooth[ws:we] = lock_cx
        cy_smooth[ws:we] = lock_cy
        return lock_cx, lock_cy

    dx = float(lock_cx - start_cx)
    dy = float(lock_cy - start_cy)
    if max(abs(dx), abs(dy)) <= _MONO_LOCK_EASE_DEADZONE:
        cx_smooth[ws:we] = start_cx
        cy_smooth[ws:we] = start_cy
        return float(start_cx), float(start_cy)

    cur_cx = float(start_cx)
    cur_cy = float(start_cy)
    ema = float(_MONO_LOCK_EASE_EMA)
    max_step = float(_MONO_LOCK_EASE_MAX_STEP)
    for i in range(ws, we):
        eased_x = ema * cur_cx + (1.0 - ema) * lock_cx
        eased_y = ema * cur_cy + (1.0 - ema) * lock_cy
        step_x = max(-max_step, min(max_step, eased_x - cur_cx))
        step_y = max(-max_step, min(max_step, eased_y - cur_cy))
        # Ne pas dépasser la cible.
        if (lock_cx - cur_cx) * (lock_cx - (cur_cx + step_x)) < 0:
            step_x = lock_cx - cur_cx
        if (lock_cy - cur_cy) * (lock_cy - (cur_cy + step_y)) < 0:
            step_y = lock_cy - cur_cy
        cur_cx += step_x
        cur_cy += step_y
        cx_smooth[i] = cur_cx
        cy_smooth[i] = cur_cy
    # Relire le buffer (float32) pour enchaîner sans dérive float64/float32.
    return float(cx_smooth[we - 1]), float(cy_smooth[we - 1])


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
    """Pure detection: returns (cx, cy, is_scene_cut)."""
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


def _lock_from_eye_samples(
    samples: list[tuple[float, float, float]] | list[tuple[float, float, float, float]],
    prefer_cx: float | None = None,
) -> tuple[float, float, float] | None:
    """Médiane des meilleurs scores yeux — une seule tête, jamais le milieu.

    Retourne (cx, cy, area_mediane) ou None.
    """
    if not samples:
        return None
    # Normalise en (cx, cy, score, area)
    norm: list[tuple[float, float, float, float]] = []
    for s in samples:
        if len(s) >= 4:
            norm.append((float(s[0]), float(s[1]), float(s[2]), float(s[3])))
        else:
            norm.append((float(s[0]), float(s[1]), float(s[2]), 0.04))
    ranked = sorted(norm, key=lambda s: -s[2])
    keep_n = max(1, (len(ranked) + 1) // 2)
    top = ranked[:keep_n]
    xs = [p[0] for p in top]
    if max(xs) - min(xs) > 0.32:
        left = [p for p in top if p[0] < 0.5]
        right = [p for p in top if p[0] >= 0.5]
        if prefer_cx is not None:
            cluster = left if prefer_cx < 0.5 else right
            if not cluster:
                cluster = left or right or top
        else:
            left_best = max((p[2] for p in left), default=-1.0)
            right_best = max((p[2] for p in right), default=-1.0)
            cluster = left if left_best >= right_best else right
            if not cluster:
                cluster = top
        return (
            float(np.median([p[0] for p in cluster])),
            float(np.median([p[1] for p in cluster])),
            float(np.median([p[3] for p in cluster])),
        )
    return (
        float(np.median([p[0] for p in top])),
        float(np.median([p[1] for p in top])),
        float(np.median([p[3] for p in top])),
    )


def _mono_zoom_for_lock(cx: float, area: float) -> float:
    """Zoom mono adapté à la taille du visage et à la proximité des bords."""
    zoom = MONO_FACE_ZOOM
    # Gros plan déjà serré : zoom léger (sinon pores / tissu / épaule).
    if area >= 0.12:
        zoom = min(zoom, 1.06)
    elif area >= 0.07:
        zoom = min(zoom, 1.14)
    elif area < 0.02:
        zoom = min(1.32, zoom + 0.06)
    pad = 0.06
    room = min(cx - pad, 1.0 - cx - pad)
    if room < 0.12:
        zoom = min(zoom, MONO_FACE_ZOOM_MIN)
    elif room < 0.20:
        zoom = min(zoom, 0.5 * (MONO_FACE_ZOOM_MIN + MONO_FACE_ZOOM))
    return float(max(MONO_FACE_ZOOM_MIN, min(1.35, zoom)))


def collect_crop_positions(
    cap: cv2.VideoCapture,
    start_pts: int,
    clip_frames: int,
    fps: float,
    seed_center: tuple[float, float] | None = None,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Pré-pass mono : vérifier les têtes (yeux) AVANT de figer le cadrage.

    1) Scan dense : scene-cuts + échantillons require_eyes=True.
    2) Par plan : fenêtres ~2.8s, lock = médiane des samples yeux (≥ min_eyes).
    3) Écriture crop : freeze par fenêtre (MONO_LOCK_EASE=0) ou ease très lent
       entre locks intra-plan (défaut). Zoom toujours figé. Pas de refine runtime.
    """
    cap.set(cv2.CAP_PROP_POS_FRAMES, start_pts)
    interval = _PREFLIGHT_INTERVAL
    window_frames = max(interval * 2, int(round(_LOCK_WINDOW_SEC * max(fps, 1.0))))
    soft_ease = _env_flag_on("MONO_LOCK_EASE", True)

    print(
        f"[SMARTCROP] preflight — {clip_frames} frames (~{clip_frames / max(fps, 1):.1f}s @ {fps:.2f}fps) "
        f"sample_every={interval} eyes_only=1 min_eyes={_PREFLIGHT_MIN_EYE_SAMPLES} "
        f"lock_window={_LOCK_WINDOW_SEC:.1f}s zoom_mono={MONO_FACE_ZOOM} "
        f"lock_ease={1 if soft_ease else 0} "
        f"cut_thr={_SCENE_CUT_THRESHOLD}/rel×{_SCENE_CUT_REL}"
        f"{f' seed=({seed_center[0]:.2f},{seed_center[1]:.2f})' if seed_center else ''}",
        flush=True,
    )

    # (frame_idx, cx, cy, score, area)
    eye_hits: list[tuple[int, float, float, float, float]] = []
    weak_hits: list[tuple[int, float, float, float, float]] = []
    scene_cuts: list[int] = []
    prev_frame: np.ndarray | None = None
    motion_ema: float | None = None
    last_cut = -_SCENE_CUT_MIN_GAP
    # Continuité multi-personnes : rester sur la même tête d'un sample à l'autre.
    running_prefer_cx: float | None = (
        float(seed_center[0]) if seed_center is not None else None
    )

    for i in range(clip_frames):
        ret, frame = cap.read()
        if not ret:
            break

        if prev_frame is not None:
            diff = np.mean(np.abs(frame.astype(float) - prev_frame.astype(float))) / 255.0
            bar = max(_SCENE_CUT_THRESHOLD, _SCENE_CUT_REL * (motion_ema or 0.0))
            is_cut = diff > bar
            if is_cut and (i - last_cut) >= _SCENE_CUT_MIN_GAP:
                scene_cuts.append(i)
                last_cut = i
            # La baseline ne suit que le mouvement « normal » : une coupe ne doit
            # pas la gonfler, sinon la coupe suivante passe sous le radar.
            if not is_cut:
                motion_ema = diff if motion_ema is None else 0.9 * motion_ema + 0.1 * diff

        if i % interval == 0 or (scene_cuts and scene_cuts[-1] == i):
            small = _downscale_for_detection(frame)
            eyed = detect_face_center_scored(
                small, prefer_cx=running_prefer_cx, require_eyes=True
            )
            if eyed is not None:
                cx, cy, sc, area = eyed
                eye_hits.append((i, float(cx), float(cy), float(sc), float(area)))
                running_prefer_cx = float(cx)
            else:
                weak = detect_face_center_scored(
                    small, prefer_cx=running_prefer_cx, require_eyes=False
                )
                if weak is not None:
                    cx, cy, sc, area = weak
                    weak_hits.append((i, float(cx), float(cy), float(sc), float(area)))

        prev_frame = frame
        if i > 0 and i % _PROGRESS_LOG_FRAMES == 0:
            print(
                f"[SMARTCROP] preflight {i}/{clip_frames} eyes={len(eye_hits)} cuts={len(scene_cuts)}...",
                flush=True,
            )

    boundaries = [0] + scene_cuts + [clip_frames]
    # Fusionne les mini-segments (faux cuts) — source #1 des frames qui flashent.
    min_shot_frames = max(interval, int(round(_MIN_SHOT_SEC * max(fps, 1.0))))
    merged: list[int] = [boundaries[0]]
    for b in boundaries[1:-1]:
        if b - merged[-1] >= min_shot_frames:
            merged.append(b)
    merged.append(boundaries[-1])
    # 2e passe : absorbe un dernier micro-segment en fin de clip.
    cleaned: list[int] = [merged[0]]
    for i, b in enumerate(merged[1:-1], start=1):
        nxt = merged[i + 1]
        if b - cleaned[-1] < min_shot_frames or nxt - b < min_shot_frames:
            continue  # saute ce cut → fusion avec voisin
        cleaned.append(b)
    cleaned.append(merged[-1])
    boundaries = cleaned
    dropped_cuts = len(scene_cuts) - max(0, len(boundaries) - 2)

    cx_smooth = np.empty(clip_frames, dtype=np.float32)
    cy_smooth = np.empty(clip_frames, dtype=np.float32)
    zoom_smooth = np.ones(clip_frames, dtype=np.float32)

    prev_lock: tuple[float, float] | None = seed_center
    prev_area = 0.04
    # Position affichée (peut différer du lock cible si soft ease partiel).
    display_cx: float | None = float(seed_center[0]) if seed_center is not None else None
    display_cy: float | None = float(seed_center[1]) if seed_center is not None else None
    eye_locks = 0
    weak_locks = 0
    held_locks = 0
    rejected_jumps = 0
    backfilled = 0
    max_seg_dx = 0.0
    window_locks = 0

    for seg_idx in range(len(boundaries) - 1):
        s = boundaries[seg_idx]
        e = boundaries[seg_idx + 1]
        # Fenêtres dans le plan : suit la tête sans refine runtime frame-à-frame.
        win_starts = list(range(s, e, window_frames))
        if not win_starts:
            win_starts = [s]
        for wi, ws in enumerate(win_starts):
            # Dernière fenêtre absorbe le reste (évite micro-fenêtre orpheline).
            we = e if wi == len(win_starts) - 1 else min(e, ws + window_frames)
            win_len = we - ws
            if win_len <= 0:
                continue
            win_eyes = [
                (cx, cy, sc, area)
                for (fi, cx, cy, sc, area) in eye_hits
                if ws <= fi < we
            ]
            win_weak = [
                (cx, cy, sc, area)
                for (fi, cx, cy, sc, area) in weak_hits
                if ws <= fi < we
            ]

            lock: tuple[float, float, float] | None = None
            used_eyes = False
            prefer_cx = prev_lock[0] if prev_lock is not None else (
                seed_center[0] if seed_center is not None else None
            )
            min_eyes = 1 if prev_lock is None else _PREFLIGHT_MIN_EYE_SAMPLES
            # Première fenêtre du clip : 2 samples min si possible, sinon 1.
            if prev_lock is None:
                min_eyes = 2 if len(win_eyes) >= 2 else 1

            if len(win_eyes) >= min_eyes:
                lock = _lock_from_eye_samples(win_eyes, prefer_cx=prefer_cx)
                used_eyes = lock is not None
            elif win_weak and prev_lock is None:
                # Weak seulement si on n'a encore AUCUN lock (évite flash micro/chaise).
                lock = _lock_from_eye_samples(win_weak, prefer_cx=prefer_cx)

            if lock is not None and prev_lock is not None:
                jump = abs(lock[0] - prev_lock[0])
                # Fenêtre courte + gros saut = artefact → garder le précédent.
                if jump >= _LOCK_JUMP_REJECT and win_len < max(min_shot_frames * 2, interval * 3):
                    lock = (prev_lock[0], prev_lock[1], prev_area)
                    rejected_jumps += 1
                    used_eyes = False
                elif not used_eyes and jump >= _LOCK_JUMP_REJECT:
                    lock = (prev_lock[0], prev_lock[1], prev_area)
                    rejected_jumps += 1
                # Gros saut avec assez d'yeux : ok (vrai changement de sujet / pan).
                elif used_eyes and jump >= 0.38 and len(win_eyes) < max(min_eyes + 1, 4):
                    # Pas assez de preuves pour changer de tête → hold.
                    lock = (prev_lock[0], prev_lock[1], prev_area)
                    rejected_jumps += 1
                    used_eyes = False

            if lock is None:
                if prev_lock is not None:
                    lock = (prev_lock[0], prev_lock[1], prev_area)
                else:
                    lock = (_DEFAULT_CX, _DEFAULT_CY, 0.04)
                held_locks += 1
            elif used_eyes:
                eye_locks += 1
            else:
                weak_locks += 1

            lock_cx = float(lock[0])
            lock_cy = float(max(_CY_CLAMP[0], min(lock[1], _CY_CLAMP[1])))
            lock_area = float(max(0.008, lock[2]))
            zoom = _mono_zoom_for_lock(lock_cx, lock_area)
            if prev_lock is not None:
                max_seg_dx = max(max_seg_dx, abs(lock_cx - prev_lock[0]))

            # 1ère fenêtre d'un plan = snap (pas d'ease inter-cuts). Soft = ease
            # lent lock→lock ensuite. MONO_LOCK_EASE=0 → freeze exact partout.
            display_cx, display_cy = _fill_mono_lock_window(
                cx_smooth,
                cy_smooth,
                zoom_smooth,
                ws,
                we,
                lock_cx,
                lock_cy,
                zoom,
                soft=soft_ease,
                snap=(wi == 0),
                start_cx=display_cx,
                start_cy=display_cy,
            )
            prev_lock = (lock_cx, lock_cy)
            prev_area = lock_area
            window_locks += 1

    print(
        f"[SMARTCROP] preflight done: {clip_frames} frames, cuts={len(scene_cuts)} "
        f"(kept={len(boundaries) - 2} dropped={dropped_cuts}), "
        f"eye_locks={eye_locks} weak_locks={weak_locks} held={held_locks} "
        f"windows={window_locks} rej_jump={rejected_jumps} eye_hits={len(eye_hits)} "
        f"lock_ease={1 if soft_ease else 0} "
        f"cx=[{float(cx_smooth.min()):.2f},{float(cx_smooth.max()):.2f}] "
        f"zoom=[{float(zoom_smooth.min()):.2f},{float(zoom_smooth.max()):.2f}] "
        f"max_seg_dx={max_seg_dx:.2f}",
        flush=True,
    )

    cap.set(cv2.CAP_PROP_POS_FRAMES, start_pts)
    return cx_smooth, cy_smooth, zoom_smooth


# ---------------------------------------------------------------------------
# MediaPipe face detection for multi-face analysis (split vertical feature)
# ---------------------------------------------------------------------------

_MP_FACE_DETECTOR = None
_MP_MODEL_PATH = str(Path(__file__).parent / "models" / "blaze_face_short_range.tflite")
_MP_DETECT_ERROR_LOGGED = False


def _get_mp_face_detector():
    global _MP_FACE_DETECTOR
    if _MP_FACE_DETECTOR is None:
        if not os.path.isfile(_MP_MODEL_PATH):
            raise FileNotFoundError(f"BlazeFace model missing: {_MP_MODEL_PATH}")
        # Delegate CPU explicite : sur Railway (Linux headless) le défaut tente
        # souvent un contexte GL → init/detect silencieux → 0 visage alors que
        # luma/ffmpeg_raw sont OK. Local Metal marchait ; prod restait raw=0.
        base_options = mp.tasks.BaseOptions(
            model_asset_path=_MP_MODEL_PATH,
            delegate=mp.tasks.BaseOptions.Delegate.CPU,
        )
        options = mp.tasks.vision.FaceDetectorOptions(
            base_options=base_options,
            # 0.42 : sous 0.40 BlazeFace accroche épaules / torses → mono dérive.
            min_detection_confidence=0.42,
            min_suppression_threshold=0.3,
        )
        _MP_FACE_DETECTOR = mp.tasks.vision.FaceDetector.create_from_options(options)
        print(
            f"[FACES] BlazeFace init OK delegate=CPU model={_MP_MODEL_PATH}",
            file=sys.stderr,
            flush=True,
        )
    return _MP_FACE_DETECTOR


# Face tuple: (cx, cy, area_ratio, has_eyes)
FaceCand = tuple[float, float, float, bool]


def _eye_anchor_from_keypoints(
    keypoints,
    bb_cx: float,
    bb_cy: float,
    bb_w_n: float,
) -> tuple[float, float, bool]:
    """
    BlazeFace keypoints: 0=right eye, 1=left eye, 2=nose, 3=mouth, …
    Ancre le crop sur le milieu des yeux (meilleur cadrage vertical + filtre micro).
    Le nez tire légèrement vers le centre du visage (évite oreille / profil).
    """
    if not keypoints or len(keypoints) < 2:
        return bb_cx, bb_cy, False
    e0, e1 = keypoints[0], keypoints[1]
    ex0, ey0 = float(e0.x), float(e0.y)
    ex1, ey1 = float(e1.x), float(e1.y)
    # Yeux effondrés / hors bbox ≈ faux positif (micro, coin d'image).
    eye_dist = abs(ex0 - ex1)
    if eye_dist < max(0.012, 0.15 * max(bb_w_n, 0.02)):
        return bb_cx, bb_cy, False
    mid_x = (ex0 + ex1) / 2.0
    mid_y = (ey0 + ey1) / 2.0
    if abs(mid_x - bb_cx) > max(0.12, bb_w_n * 0.85):
        return bb_cx, bb_cy, False
    if mid_y < 0.02 or mid_y > 0.72:
        return bb_cx, bb_cy, False
    # Nez : recentre horizontalement (profil → moins d'oreille / arrière de tête).
    if len(keypoints) >= 3:
        nx = float(keypoints[2].x)
        ny = float(keypoints[2].y)
        if abs(nx - mid_x) <= max(0.10, bb_w_n * 0.9) and abs(ny - mid_y) <= 0.14:
            mid_x = 0.55 * mid_x + 0.45 * nx
            # Garde l'ancre haute (yeux), ne descend pas vers la bouche.
            mid_y = 0.90 * mid_y + 0.10 * min(ny, mid_y + 0.03)
    # Très légèrement sous les yeux = centre de tête naturel pour 9:16.
    return mid_x, min(mid_y + 0.012, 0.48), True


def _merge_face_candidates(
    raw: list[FaceCand],
    min_area_ratio: float,
    min_horizontal_distance: float,
    min_absolute_area: float,
) -> list[FaceCand]:
    if not raw:
        return []
    max_area = max(r[2] for r in raw)
    filtered = [r for r in raw if r[2] >= min_area_ratio * max_area and r[2] >= min_absolute_area]
    # Yeux d'abord, puis aire — évite qu'un gros blob sans yeux batte une vraie tête.
    filtered.sort(key=lambda r: (r[3], r[2]), reverse=True)
    kept: list[FaceCand] = []
    for face in filtered:
        too_close = False
        for existing in kept:
            if abs(face[0] - existing[0]) < min_horizontal_distance:
                too_close = True
                break
        if not too_close:
            kept.append(face)
    return kept


def _detect_faces_mp_raw(frame: np.ndarray) -> list[FaceCand]:
    global _MP_DETECT_ERROR_LOGGED
    detector = _get_mp_face_detector()
    # MediaPipe exige un buffer C-contiguous RGB ; les crops numpy (vues) et le
    # raw pipe peuvent être non-contig → detect() vide ou throw selon plateforme.
    rgb = np.ascontiguousarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    try:
        result = detector.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
    except Exception as err:
        if not _MP_DETECT_ERROR_LOGGED:
            print(f"[FACES] detect() failed: {err!r}", file=sys.stderr, flush=True)
            _MP_DETECT_ERROR_LOGGED = True
        raise
    if not result.detections:
        return []
    h_frame, w_frame = frame.shape[:2]
    raw: list[FaceCand] = []
    for det in result.detections:
        bb = det.bounding_box
        bb_cx = (bb.origin_x + bb.width / 2.0) / w_frame
        bb_cy = (bb.origin_y + bb.height / 2.0) / h_frame
        bb_w_n = bb.width / w_frame
        area = (bb.width / w_frame) * (bb.height / h_frame)
        cx, cy, has_eyes = _eye_anchor_from_keypoints(
            det.keypoints, bb_cx, bb_cy, bb_w_n
        )
        raw.append((float(cx), float(cy), float(area), bool(has_eyes)))
    return raw


def _detect_faces_haar_raw(frame: np.ndarray) -> list[FaceCand]:
    """Haar frontal + profil — meilleur que BlazeFace short-range sur plans moyens usine."""
    h_frame, w_frame = frame.shape[:2]
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    raw: list[FaceCand] = []
    frontal = _get_frontal_cascade()
    if frontal is not None:
        for x, y, w, h in frontal.detectMultiScale(
            gray, scaleFactor=1.08, minNeighbors=4, minSize=(40, 40)
        ):
            raw.append(
                ((x + w / 2) / w_frame, (y + h / 2) / h_frame, (w / w_frame) * (h / h_frame), False)
            )
    profile = _get_profile_cascade()
    if profile is not None:
        for x, y, w, h in profile.detectMultiScale(
            gray, scaleFactor=1.08, minNeighbors=4, minSize=(40, 40)
        ):
            raw.append(
                ((x + w / 2) / w_frame, (y + h / 2) / h_frame, (w / w_frame) * (h / h_frame), False)
            )
        flipped = cv2.flip(gray, 1)
        for x, y, w, h in profile.detectMultiScale(
            flipped, scaleFactor=1.08, minNeighbors=4, minSize=(40, 40)
        ):
            cx = 1.0 - (x + w / 2) / w_frame
            raw.append((cx, (y + h / 2) / h_frame, (w / w_frame) * (h / h_frame), False))
    return raw


def _face_scan_windows(w_frame: int, h_frame: int) -> list[tuple[int, int, int, int]]:
    """
    Fenêtres CARRÉES glissantes couvrant la bande des têtes.

    BlazeFace short-range redimensionne son entrée en 128×128 : un visage large
    de 10% d'une image 1920 n'y occupe plus que ~13 px et n'est jamais détecté.
    C'est exactement le plan large « 2 personnes aux extrémités » — le plus
    propice au split, et celui qui échouait.

    Deux bandes Y (têtes hautes ~0.28 + mid ~0.42) : un seul centre à 0.42
    ratait les podcasts table où cy≈0.20.
    """
    if w_frame <= 0 or h_frame <= 0:
        return []
    # Portrait / carré : source déjà « zoomée », la passe pleine image suffit.
    if w_frame < h_frame * 1.2:
        return []
    side = min(max(64, w_frame // 3), h_frame)
    step = max(1, int(side * 0.75))
    windows: list[tuple[int, int, int, int]] = []
    seen: set[tuple[int, int, int, int]] = set()
    for y_frac in (0.28, 0.42):
        y0 = max(0, min(int(h_frame * y_frac) - side // 2, h_frame - side))
        x = 0
        while True:
            x0 = min(x, w_frame - side)
            win = (x0, y0, x0 + side, y0 + side)
            if win not in seen:
                seen.add(win)
                windows.append(win)
            if x0 + side >= w_frame:
                break
            x += step
    return windows


def detect_all_faces_mp(
    frame: np.ndarray,
    min_area_ratio: float = 0.35,
    min_horizontal_distance: float = 0.25,
    min_absolute_area: float = 0.005,
    include_haar: bool = True,
) -> list[FaceCand]:
    """
    Detect all faces — MediaPipe short-range : passe pleine image + fenêtres
    carrées glissantes (+ Haar optionnel).

    La passe pleine image attrape les gros plans ; les fenêtres rattrapent les
    plans larges, invisibles pour le modèle short-range seul (cf.
    `_face_scan_windows`). Ancre sur les yeux quand les keypoints BlazeFace sont
    fiables.

    `include_haar=False` pour le cadrage mono : Haar confond souvent un micro
    boom noir avec un visage.

    Returns a list of (cx, cy, area_ratio, has_eyes) normalised 0-1.
    """
    h_frame, w_frame = frame.shape[:2]
    raw: list[FaceCand] = []
    global _MP_DETECT_ERROR_LOGGED

    try:
        raw.extend(_detect_faces_mp_raw(frame))
    except Exception as err:
        if not _MP_DETECT_ERROR_LOGGED:
            print(f"[FACES] full-frame detect error: {err!r}", file=sys.stderr, flush=True)
            _MP_DETECT_ERROR_LOGGED = True

    try:
        for x0, y0, x1, y1 in _face_scan_windows(w_frame, h_frame):
            crop = frame[y0:y1, x0:x1]
            if crop.size == 0:
                continue
            # Contiguous copy : les vues crop échouent sur certaines builds MP Linux.
            crop = np.ascontiguousarray(crop)
            span_x = (x1 - x0) / w_frame
            span_y = (y1 - y0) / h_frame
            for cx, cy, area, has_eyes in _detect_faces_mp_raw(crop):
                # coordonnées locales à la fenêtre → remap sur la frame entière
                raw.append((
                    x0 / w_frame + cx * span_x,
                    y0 / h_frame + cy * span_y,
                    area * span_x * span_y,
                    has_eyes,
                ))
    except Exception as err:
        if not _MP_DETECT_ERROR_LOGGED:
            print(f"[FACES] window detect error: {err!r}", file=sys.stderr, flush=True)
            _MP_DETECT_ERROR_LOGGED = True

    if include_haar:
        try:
            raw.extend(_detect_faces_haar_raw(frame))
        except Exception:
            pass

    return _merge_face_candidates(raw, min_area_ratio, min_horizontal_distance, min_absolute_area)


# Chaque sample = une passe MediaPipe. Sans borne, un clip long faisait exploser
# le timeout côté Node → analysis=null → « no split (no analysis) ».
# C'est le mode d'échec typiquement *Railway-only* (CPU partagé entre replicas,
# alors que le Mac local passait sous la barre).
_ANALYZE_MAX_SAMPLES: int = int(os.environ.get("FACE_ANALYZE_MAX_SAMPLES", "40")) or 40


def _read_png_sequence(
    tmpdir: str,
    n: int,
    start: float,
    duration: float,
) -> list[tuple[float, np.ndarray]]:
    step = duration / n if n > 0 else 0.0
    out: list[tuple[float, np.ndarray]] = []
    for i in range(n):
        path = os.path.join(tmpdir, f"f{i + 1:03d}.png")
        if not os.path.isfile(path):
            continue
        frame = cv2.imread(path)
        if frame is None:
            continue
        out.append((float(start) + (i + 0.5) * step, frame))
    return out


def _ffmpeg_extract_raw_pipe(
    video_path: str,
    start: float,
    duration: float,
    n: int,
) -> tuple[list[tuple[float, np.ndarray]], str | None]:
    """
    Extract frames as raw BGR via pipe (seek décodé).

    Important : `-ss` AVANT `-i` (input seek) sur proxy ultrafast peut coller
    toutes les samples au même keyframe → N frames « OK » mais contenu solo
    identique → rejects={"solo":N}. `-ss` APRÈS `-i` force le bon timestamp.
    """
    fps = max(0.05, n / duration)
    # Dimensions paires fixes : parse raw sans ffprobe.
    out_w, out_h = 720, 404
    frame_bytes = out_w * out_h * 3
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        video_path,
        "-ss",
        f"{max(0.0, start):.3f}",
        "-t",
        f"{duration:.3f}",
        "-vf",
        f"fps={fps:.6f},scale={out_w}:{out_h}:flags=fast_bilinear",
        "-frames:v",
        str(n),
        "-an",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "bgr24",
        "pipe:1",
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=180, check=False)
    except Exception as err:
        return [], f"exception={err}"
    if proc.returncode != 0:
        err = (proc.stderr or b"").decode("utf-8", errors="replace")[:240]
        return [], f"rc={proc.returncode} err={err!r}"
    blob = proc.stdout or b""
    if len(blob) < frame_bytes:
        return [], f"short raw pipe ({len(blob)} bytes)"
    step = duration / n if n > 0 else 0.0
    out: list[tuple[float, np.ndarray]] = []
    max_frames = min(n, len(blob) // frame_bytes)
    for i in range(max_frames):
        chunk = blob[i * frame_bytes : (i + 1) * frame_bytes]
        frame = np.frombuffer(chunk, dtype=np.uint8).reshape((out_h, out_w, 3)).copy()
        out.append((float(start) + (i + 0.5) * step, frame))
    if not out:
        return [], "raw pipe produced 0 frames"
    return out, None


def _ffmpeg_extract_batch(
    video_path: str,
    start: float,
    duration: float,
    n: int,
    *,
    accurate: bool,
) -> tuple[list[tuple[float, np.ndarray]], str | None]:
    """Batch PNG via ffmpeg (fallback si raw pipe indisponible)."""
    fps = max(0.05, n / duration)
    tmpdir = tempfile.mkdtemp(prefix="vyrll-face-")
    try:
        pattern = os.path.join(tmpdir, "f%03d.png")
        cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error"]
        if not accurate:
            # Input seek — rapide mais dangereux sur GOP long (cf. raw pipe).
            cmd += ["-ss", f"{max(0.0, start):.3f}", "-t", f"{duration:.3f}", "-i", video_path]
        else:
            cmd += ["-i", video_path, "-ss", f"{max(0.0, start):.3f}", "-t", f"{duration:.3f}"]
        cmd += [
            "-vf",
            f"fps={fps:.6f},scale=720:-2",
            "-frames:v",
            str(n),
            "-an",
            "-y",
            pattern,
        ]
        proc = subprocess.run(cmd, capture_output=True, timeout=180, check=False)
        if proc.returncode != 0:
            err = (proc.stderr or b"").decode("utf-8", errors="replace")[:240]
            return [], f"rc={proc.returncode} err={err!r}"
        frames = _read_png_sequence(tmpdir, n, start, duration)
        if not frames:
            return [], "rc=0 but no png written"
        return frames, None
    except Exception as err:
        return [], f"exception={err}"
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def _ffmpeg_extract_singles(
    video_path: str,
    start: float,
    end: float,
    num_samples: int,
) -> tuple[list[tuple[float, np.ndarray]], str | None]:
    """Dernier recours fiable : 1 frame / sample via ffmpeg -ss (jamais OpenCV)."""
    duration = max(0.0, float(end) - float(start))
    n = max(1, int(num_samples))
    step = duration / n if n > 0 else 0.0
    out: list[tuple[float, np.ndarray]] = []
    last_err = None
    for i in range(n):
        t = float(start) + (i + 0.5) * step
        tmp = tempfile.NamedTemporaryFile(prefix="vyrll-face1-", suffix=".png", delete=False)
        tmp_path = tmp.name
        tmp.close()
        try:
            cmd = [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                video_path,
                "-ss",
                f"{max(0.0, t):.3f}",
                "-frames:v",
                "1",
                "-vf",
                "scale=720:-2",
                "-an",
                "-y",
                tmp_path,
            ]
            proc = subprocess.run(cmd, capture_output=True, timeout=60, check=False)
            if proc.returncode != 0 or not os.path.isfile(tmp_path):
                last_err = (proc.stderr or b"").decode("utf-8", errors="replace")[:160]
                continue
            frame = cv2.imread(tmp_path)
            if frame is not None:
                out.append((t, frame))
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
    if not out:
        return [], last_err or "singles produced 0 frames"
    return out, None


def _extract_analysis_frames(
    video_path: str,
    start: float,
    end: float,
    num_samples: int,
) -> tuple[list[tuple[float, np.ndarray]], str, str | None]:
    """
    Extrait N frames via ffmpeg uniquement (pas d'OpenCV POS_FRAMES).

    Retourne (frames, sample_source, error_or_none).
    Priorité : raw pipe + seek décodé (timestamps fiables sur Railway).
    """
    duration = max(0.0, float(end) - float(start))
    n = max(1, int(num_samples))
    if duration <= 0 or not video_path or not os.path.exists(video_path):
        return [], "none", "missing video or empty window"

    frames, err = _ffmpeg_extract_raw_pipe(video_path, start, duration, n)
    if frames:
        return frames, "ffmpeg_raw", None
    print(f"[FACES] ffmpeg raw pipe failed: {err}", file=sys.stderr, flush=True)

    frames, err2 = _ffmpeg_extract_batch(video_path, start, duration, n, accurate=True)
    if frames:
        return frames, "ffmpeg_accurate", None
    print(f"[FACES] ffmpeg accurate failed: {err2}", file=sys.stderr, flush=True)

    frames, err3 = _ffmpeg_extract_singles(video_path, start, end, n)
    if frames:
        return frames, "ffmpeg_singles", None
    return [], "none", err3 or err2 or err


def _iter_analysis_frames(
    video_path: str,
    start: float,
    end: float,
    num_samples: int,
    step: float,
):
    """
    Yield (t, frame, sample_source). ffmpeg only — OpenCV seek interdit ici
    (Railway CPU : POS_FRAMES → faux solo).
    """
    _ = step
    frames, source, err = _extract_analysis_frames(video_path, start, end, num_samples)
    print(
        f"[FACES] sample_source={source} n={len(frames)}/{num_samples} "
        f"window={start:.1f}→{end:.1f}s"
        + (f" err={err}" if err else ""),
        file=sys.stderr,
        flush=True,
    )
    for t, frame in frames:
        yield t, frame, source


class _FrameBank:
    """Frames horodatées (ffmpeg) pour seeks fiables sans OpenCV POS_FRAMES."""

    __slots__ = ("times", "frames", "source")

    def __init__(
        self,
        times: list[float],
        frames: list[np.ndarray],
        source: str,
    ):
        self.times = times
        self.frames = frames
        self.source = source

    def nearest(self, t_abs: float) -> np.ndarray | None:
        if not self.times:
            return None
        # Recherche linéaire OK (≤~400 sondes) ; évite bisect+import.
        best_i = 0
        best_d = abs(self.times[0] - t_abs)
        for i in range(1, len(self.times)):
            d = abs(self.times[i] - t_abs)
            if d < best_d:
                best_d = d
                best_i = i
        return self.frames[best_i]


def _load_frame_bank(
    video_path: str,
    start: float,
    end: float,
    interval_sec: float,
    *,
    max_frames: int = 360,
    label: str = "LAYOUT",
) -> _FrameBank:
    """Banque de frames pour mask/preflight split — ffmpeg only (pas OpenCV seek)."""
    duration = max(0.0, float(end) - float(start))
    interval = max(0.05, float(interval_sec))
    n = max(1, int(math.ceil(duration / interval))) if duration > 0 else 1
    n = min(n, max_frames)
    pairs, source, err = _extract_analysis_frames(video_path, start, end, n)
    print(
        f"[{label}] frame_bank={source} n={len(pairs)}/{n} "
        f"interval≈{duration / max(len(pairs), 1):.2f}s "
        f"window={start:.1f}→{end:.1f}s"
        + (f" err={err}" if err else ""),
        flush=True,
    )
    return _FrameBank(
        [t for t, _ in pairs],
        [fr for _, fr in pairs],
        source,
    )


def analyze_face_count_for_clip(
    video_path: str,
    start: float,
    end: float,
    sample_interval: float = 1.2,
    multi_face_threshold: float = 0.65,
) -> dict:
    """
    Échantillonne [start, end] et compte les frames réellement propices au split.

    Source de vérité UNIQUE : `assess_split_clean` — exactement le test utilisé au
    rendu (`build_dynamic_layout_mask` / `preflight_split_segments`). Avant, ce
    compteur avait ses propres seuils *et* sa propre paire (les 2 plus grandes
    aires) : sur 2 personnes aux extrémités d'une table avec une 3e détection,
    la paire par aire pouvait être 2 têtes voisines → dist < 0.36 → frame
    rejetée. Le gate serveur repassait en mono alors que le rendu aurait produit
    un split propre. Les deux étages ne peuvent plus diverger.

    Renvoie aussi `max_clean_run_sec` : plus longue plage clean *continue*. C'est
    ce que le rendu sait committer (min_split ≈ 2s), donc le vrai prédicteur d'un
    split stable — là où le ratio global confond « un vrai 2-shot de 8s » et
    « 7 frames éparpillées ».
    """
    duration = max(0.0, end - start)
    num_samples = max(1, int(duration / sample_interval)) if duration > 0 else 1
    num_samples = min(num_samples, _ANALYZE_MAX_SAMPLES)
    step = (duration / num_samples) if num_samples > 0 else 0.0

    multi_face_count = 0
    loose_multi_count = 0
    clean_reasons: dict[str, int] = {}
    reject_reasons: dict[str, int] = {}
    # Cluster by horizontal side (left/right) so the same person stays in the same slot.
    left_samples: list[tuple[float, float, float]] = []
    right_samples: list[tuple[float, float, float]] = []
    loose_left_samples: list[tuple[float, float, float]] = []
    loose_right_samples: list[tuple[float, float, float]] = []
    clean_run = 0
    max_clean_run = 0
    sampled = 0
    sample_source = "none"
    luma_vals: list[float] = []
    raw_face_hist = {"0": 0, "1": 0, "2plus": 0}

    for _t, frame, sample_source in _iter_analysis_frames(
        video_path, start, end, num_samples, step
    ):
        sampled += 1
        try:
            luma_vals.append(float(frame.mean()))
        except Exception:
            pass
        # Preuve : combien de têtes brutes avant les seuils clean (0 = frames mortes
        # ou BlazeFace aveugle ; 2+ = détection OK, gate/clean trop strict).
        try:
            raw_n = len(
                detect_all_faces_mp(
                    frame,
                    min_area_ratio=0.15,
                    min_absolute_area=0.0015,
                    min_horizontal_distance=0.10,
                    include_haar=False,
                )
            )
        except Exception:
            raw_n = 0
        if raw_n <= 0:
            raw_face_hist["0"] += 1
        elif raw_n == 1:
            raw_face_hist["1"] += 1
        else:
            raw_face_hist["2plus"] += 1

        result = assess_split_clean(frame)
        if result.clean and result.pair is not None:
            left, right, area_left, area_right = result.pair
            clean_reasons[result.reason] = clean_reasons.get(result.reason, 0) + 1
            multi_face_count += 1
            left_samples.append((left[0], left[1], area_left))
            right_samples.append((right[0], right[1], area_right))
            clean_run += 1
            max_clean_run = max(max_clean_run, clean_run)
            continue

        reject_reasons[result.reason or "reject"] = (
            reject_reasons.get(result.reason or "reject", 0) + 1
        )
        clean_run = 0
        # Fallback podcast / plans difficiles : 2 têtes L/R assez écartées même si
        # assess_split_clean refuse (peau, yeux, déséquilibre). Sans ça le gate
        # serveur reste à multi=0 et n'essaie jamais le hybrid split alors que le
        # renderer saurait basculer frame par frame.
        try:
            faces = detect_all_faces_mp(
                frame,
                min_area_ratio=0.18,
                min_absolute_area=0.0022,
                min_horizontal_distance=0.14,
                include_haar=False,
            )
        except Exception:
            faces = []
        if len(faces) < 2:
            continue
        by_x = sorted(faces[:4], key=lambda f: f[0])
        left_f, right_f = by_x[0], by_x[-1]
        dist = float(abs(right_f[0] - left_f[0]))
        areas = sorted((left_f[2], right_f[2]), reverse=True)
        area_ok = areas[0] > 0 and areas[1] >= 0.22 * areas[0]
        if dist < SPLIT_MIN_CENTER_SEP * 0.92 or not area_ok:
            continue
        # Même garde-fou peau que assess_split_clean — sinon loose = épaules.
        skin_l = _face_roi_skin_score(frame, left_f[0], left_f[1], left_f[2])
        skin_r = _face_roi_skin_score(frame, right_f[0], right_f[1], right_f[2])
        if min(skin_l, skin_r) < SPLIT_CLEAN_MIN_SKIN:
            continue
        loose_multi_count += 1
        loose_left_samples.append((float(left_f[0]), float(left_f[1]), float(left_f[2])))
        loose_right_samples.append(
            (float(right_f[0]), float(right_f[1]), float(right_f[2]))
        )

    denom = sampled if sampled > 0 else num_samples
    confidence = multi_face_count / denom if denom > 0 else 0.0
    loose_confidence = loose_multi_count / denom if denom > 0 else 0.0
    face_count_mode = 2 if max(confidence, loose_confidence) >= multi_face_threshold else 1

    def _median_face(samples: list[tuple[float, float, float]]) -> dict[str, float] | None:
        if not samples:
            return None
        xs = sorted(s[0] for s in samples)
        ys = sorted(s[1] for s in samples)
        areas = sorted(s[2] for s in samples)
        mid = len(samples) // 2
        return {"cx": xs[mid], "cy": ys[mid], "area": areas[mid]}

    def _positions_from_sides(
        left_s: list[tuple[float, float, float]],
        right_s: list[tuple[float, float, float]],
        *,
        min_sep: float,
    ) -> tuple[list[dict[str, float]], float]:
        left = _median_face(left_s)
        right = _median_face(right_s)
        if not left or not right:
            return [], 0.0
        sep = abs(left["cx"] - right["cx"])
        if sep < min_sep:
            print(
                f"[FACES] median L/R trop proches (sep={sep:.3f} < {min_sep}) — pas de split positions",
                file=sys.stderr,
                flush=True,
            )
            return [], 0.0
        primary, secondary = (
            (left, right) if left["area"] >= right["area"] else (right, left)
        )
        ratio = secondary["area"] / primary["area"] if primary["area"] > 0 else 0.0
        return [primary, secondary], ratio

    median_positions, area_ratio = _positions_from_sides(
        left_samples, right_samples, min_sep=SPLIT_MIN_CENTER_SEP
    )
    positions_source = "clean" if median_positions else "none"
    if not median_positions:
        median_positions, area_ratio = _positions_from_sides(
            loose_left_samples,
            loose_right_samples,
            min_sep=SPLIT_MIN_CENTER_SEP * 0.92,
        )
        if median_positions:
            positions_source = "loose"

    return {
        "face_count_mode": face_count_mode,
        "confidence": round(max(confidence, loose_confidence), 3),
        "total_sampled": denom,
        "multi_face_frames": max(multi_face_count, loose_multi_count),
        "clean_multi_face_frames": multi_face_count,
        "loose_multi_face_frames": loose_multi_count,
        "median_positions": median_positions,
        "positions_source": positions_source,
        "area_ratio": round(area_ratio, 3),
        # Plage clean continue la plus longue (estimée : n_samples × pas).
        "max_clean_run_sec": round(max_clean_run * step, 2),
        "sample_interval_sec": round(step, 3),
        "clean_reasons": clean_reasons,
        "reject_reasons": reject_reasons,
        "sample_source": sample_source,
        "luma_mean": round(float(np.mean(luma_vals)), 1) if luma_vals else None,
        "luma_std": round(float(np.std(luma_vals)), 1) if len(luma_vals) > 1 else 0.0,
        "raw_face_hist": raw_face_hist,
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
        if prev_center is not None:
            return prev_center
        return (_DEFAULT_CX, _DEFAULT_CY)
    return (cx, max(_CY_CLAMP[0], min(cy, _CY_CLAMP[1])))


def resize_and_crop_frame(
    frame: np.ndarray,
    out_w: int,
    out_h: int,
    crop_center: tuple[float, float] | None,
    zoom: float = 1.0,
    eye_y_in_frame: float = MONO_EYE_Y_IN_FRAME,
) -> np.ndarray:
    """
    Redimensionne et crop la frame pour remplir out_w x out_h.
    crop_center: (x, y) normalisés 0-1 (ancre yeux/tête). None = centre.
    zoom > 1 : serre sur la tête (évite épaule/buste en pleine hauteur paysage).
    eye_y_in_frame : place l'ancre dans le tiers haut du 9:16 quand le zoom
    active un crop vertical.
    """
    src_h, src_w = frame.shape[:2]
    ar_src = src_w / src_h
    ar_out = out_w / out_h

    if ar_src > ar_out:
        scale = out_h / src_h
    else:
        scale = out_w / src_w

    zoom = float(max(1.0, min(1.45, zoom or 1.0)))
    scale *= zoom

    new_w = max(out_w, int(round(src_w * scale)))
    new_h = max(out_h, int(round(src_h * scale)))
    scaled = cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_LANCZOS4)

    if crop_center is not None:
        cx, cy = crop_center
        center_x = int(cx * new_w)
        center_y = int(cy * new_h)
    else:
        center_x = new_w // 2
        center_y = new_h // 2

    # Bornes du crop — horizontal centré sur la tête.
    x1 = max(0, center_x - out_w // 2)
    x2 = min(new_w, x1 + out_w)
    x1 = max(0, x2 - out_w)
    # Vertical : yeux dans le tiers haut (si new_h > out_h grâce au zoom).
    guide = float(max(0.28, min(0.50, eye_y_in_frame)))
    y1 = max(0, center_y - int(out_h * guide))
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
    out_h: int = 1920,
    separator_px: int = SPLIT_SEPARATOR_PX,
    area_top: float | None = None,
    area_bottom: float | None = None,
) -> np.ndarray:
    """
    Produit un frame split vertical asymétrique 9:16 :
    - haut = personne principale (~60%, top_h)
    - bas = seconde personne (~40%, bottom_h)
    center_top / center_bottom : (cx, cy) normalisés 0-1 pour chaque panneau.

    Le zoom s'adapte à la proximité des bords : un visage près du bord gauche/droit
    ne doit plus être coupé par un clamp agressif (symptôme A coupé à gauche /
    B coupé à droite).
    """
    src_h, src_w = frame.shape[:2]
    # Ajuste les hauteurs si un séparateur est présent pour rester à out_h pile.
    out_total = out_h
    scale = out_h / 1920.0 if out_h > 0 else 1.0
    base_top = int(round(SPLIT_TOP_H * scale))
    base_bottom = int(round(SPLIT_BOTTOM_H * scale))
    if separator_px > 0:
        usable = out_total - separator_px
        top_h = int(round(usable * (base_top / max(1, base_top + base_bottom))))
        bottom_h = usable - top_h
    else:
        top_h = base_top
        bottom_h = out_total - top_h

    cx_t, cy_t = float(center_top[0]), float(center_top[1])
    cx_b, cy_b = float(center_bottom[0]), float(center_bottom[1])
    # Ne plus inventer des centres artificiels (mid ± sep/2) : ça poussait les
    # crops loin des vrais visages → un panneau coupe à gauche, l'autre à droite.
    # Si trop proches, on reste sur les détections ; le zoom gère l'isolation.

    def _face_pad(area: float | None) -> float:
        # sqrt(area) ≈ largeur normalisée du bbox ; + marge joues/cheveux.
        half_w = 0.5 * (max(area or 0.02, 0.008) ** 0.5)
        return max(SPLIT_FACE_EDGE_PAD, min(0.14, half_w + 0.04))

    # Un seul scale pour les deux panneaux (même zoom relatif), dimensionné
    # pour remplir le panneau le plus exigeant en hauteur.
    max_panel_h = max(top_h, bottom_h)
    cover = max(out_w / src_w, max_panel_h / src_h)
    # Zoom partagé = le plus conservateur des deux visages. Près d'un bord source,
    # on baisse le zoom (plus de contexte) pour éviter le clamp qui coupe la joue.
    zoom = SPLIT_FACE_ZOOM
    for cx, area in ((cx_t, area_top), (cx_b, area_bottom)):
        pad = _face_pad(area)
        room = min(cx - pad, 1.0 - cx - pad)
        if room < 0.12:
            zoom = min(zoom, SPLIT_FACE_ZOOM_MIN)
        elif room < 0.20:
            zoom = min(zoom, 0.5 * (SPLIT_FACE_ZOOM_MIN + SPLIT_FACE_ZOOM))
    zoom = max(SPLIT_FACE_ZOOM_MIN, min(SPLIT_FACE_ZOOM, zoom))

    scale = cover * zoom
    new_w = max(out_w, int(src_w * scale))
    new_h = max(max_panel_h, int(src_h * scale))
    scaled = cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_LANCZOS4)

    def crop_at_center(
        cx: float,
        cy: float,
        panel_h: int,
        area: float | None,
        *,
        is_bottom: bool = False,
    ) -> np.ndarray:
        # Haut : visage ~36% (règle des tiers).
        # Bas : un peu plus haut dans le panneau (0.40) pour laisser de l'air aux
        # sous-titres en bas, tout en gardant une marge ≥12% sous le séparateur.
        face_y_in_panel = 0.40 if is_bottom else 0.36
        # Sur le panneau bas, remonter un peu le centre source pour garder du front.
        cy_shift = 0.04 if is_bottom else 0.02
        cy_n = max(0.14, min(0.55, cy - cy_shift))
        center_x = int(cx * new_w)
        center_y = int(cy_n * new_h)
        y1 = int(center_y - panel_h * face_y_in_panel)
        y1 = max(0, min(y1, new_h - panel_h))
        y2 = y1 + panel_h
        # Filet séparateur : imposer une marge mini sous le haut du panneau bas.
        if is_bottom:
            min_top_pad = int(0.12 * panel_h)
            face_from_top = center_y - y1
            if face_from_top < min_top_pad:
                y1 = max(0, min(center_y - min_top_pad, new_h - panel_h))
                y2 = y1 + panel_h
        x1 = center_x - out_w // 2
        x1 = max(0, min(x1, new_w - out_w))
        x2 = x1 + out_w
        # Après clamp : si le visage est trop près d'un bord du panneau, recentre
        # dans l'espace encore disponible (évite joue/crâne coupés).
        pad_px = int(_face_pad(area) * new_w)
        face_in_crop = center_x - x1
        if face_in_crop < pad_px:
            # Pousse le crop vers la gauche (si possible) pour dégager le visage.
            x1 = max(0, min(center_x - pad_px, new_w - out_w))
            x2 = x1 + out_w
        elif face_in_crop > out_w - pad_px:
            x1 = max(0, min(center_x - (out_w - pad_px), new_w - out_w))
            x2 = x1 + out_w
        crop = scaled[y1:y2, x1:x2]
        if crop.shape[0] != panel_h or crop.shape[1] != out_w:
            crop = cv2.resize(crop, (out_w, panel_h), interpolation=cv2.INTER_LANCZOS4)
        return crop

    top_crop = crop_at_center(cx_t, cy_t, top_h, area_top, is_bottom=False)
    bottom_crop = crop_at_center(cx_b, cy_b, bottom_h, area_bottom, is_bottom=True)

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
    prev_two_shot_ok: bool = True,
) -> tuple[tuple[float, float], tuple[float, float], bool]:
    """
    Retourne (center_top, center_bottom, two_shot_ok).

    `two_shot_ok=False` si le recalib ne voit plus 2 têtes séparées — le caller
    doit basculer en mono (évite même personne / épaule dans les 2 panneaux
    après un cut gros plan solo).
    """
    fallback_top = (init_positions[0]["cx"], init_positions[0]["cy"]) if len(init_positions) > 0 else (0.33, 0.4)
    fallback_bottom = (init_positions[1]["cx"], init_positions[1]["cy"]) if len(init_positions) > 1 else (0.67, 0.4)
    # Qui est à gauche au départ ? On garde cette association top/bottom.
    top_is_left = fallback_top[0] <= fallback_bottom[0]

    target_top = prev_top if prev_top else fallback_top
    target_bottom = prev_bottom if prev_bottom else fallback_bottom
    two_shot_ok = prev_two_shot_ok
    # Check solo toutes les 5 frames (~6×/s @ 30fps) pour quitter vite un faux split.
    solo_check_interval = 5

    # Validité 2-shot plus fréquente que le pan (réagir vite au cut solo).
    if frame_idx % solo_check_interval == 0:
        faces_quick = detect_all_faces_mp(
            frame,
            min_area_ratio=0.28,
            min_absolute_area=0.0035,
            min_horizontal_distance=0.18,
        )
        if len(faces_quick) < 2:
            two_shot_ok = False
        else:
            dist_q = abs(faces_quick[0][0] - faces_quick[1][0])
            area_q = (
                faces_quick[1][2] / faces_quick[0][2] if faces_quick[0][2] > 0 else 0.0
            )
            two_shot_ok = dist_q >= SPLIT_MIN_CENTER_SEP and area_q >= 0.36

    # ~0.6× / seconde à 30fps — moins de recalibrages = moins de micro-pans
    if two_shot_ok and frame_idx % recalib_interval == 0:
        faces = detect_all_faces_mp(
            frame,
            min_area_ratio=0.28,
            min_absolute_area=0.0035,
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
                    # Plus de vrai 2-shot → forcer mono côté caller
                    two_shot_ok = False
                    cand_top, cand_bot = target_top, target_bottom

            if two_shot_ok:
                # Aires trop déséquilibrées = talking-head + fantôme
                areas = sorted((f[2] for f in remaining_faces_snapshot[:2]), reverse=True)
                if len(areas) >= 2 and areas[0] > 0 and areas[1] < 0.36 * areas[0]:
                    two_shot_ok = False

            if two_shot_ok:
                if prev_top is None or abs(cand_top[0] - prev_top[0]) + abs(cand_top[1] - prev_top[1]) > deadzone:
                    target_top = cand_top
                if prev_bottom is None or abs(cand_bot[0] - prev_bottom[0]) + abs(cand_bot[1] - prev_bottom[1]) > deadzone:
                    target_bottom = cand_bot
        else:
            # Gros plan solo / dos : ne pas garder le split A+épaule
            two_shot_ok = False

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
            if abs(target_top[0] - target_bottom[0]) >= SPLIT_MIN_CENTER_SEP:
                return (target_top, target_bottom, two_shot_ok)
            return (fallback_top, fallback_bottom, False)
        return (out_top, out_bot, two_shot_ok)
    return (target_top, target_bottom, two_shot_ok)


def _stabilize_layout_mask(
    mask: np.ndarray,
    out_fps: float,
    min_split_sec: float = 2.8,
    min_mono_gap_sec: float = 1.2,
) -> np.ndarray:
    """Supprime les micro-bascules split↔mono (blinks d'1–2 s).

    1) Comble les trous mono courts à l'intérieur d'un split (évite split→mono→split).
       Gap max court (1.2s) : un vrai cut POV solo ne doit PAS être recollé en split.
    2) Retire les bursts split trop courts (souvent 1 tête / faux 2-shot).
    """
    if mask.size == 0 or out_fps <= 0:
        return mask
    out = mask.copy()
    min_split = max(1, int(round(min_split_sec * out_fps)))
    min_gap = max(1, int(round(min_mono_gap_sec * out_fps)))

    def _runs(arr: np.ndarray) -> list[tuple[int, int, bool]]:
        runs: list[tuple[int, int, bool]] = []
        i = 0
        n = len(arr)
        while i < n:
            j = i + 1
            while j < n and bool(arr[j]) == bool(arr[i]):
                j += 1
            runs.append((i, j, bool(arr[i])))
            i = j
        return runs

    # Pass 1: fill short mono gaps between split
    for _ in range(2):
        runs = _runs(out)
        changed = False
        for k, (s, e, is_split) in enumerate(runs):
            if is_split:
                continue
            if k == 0 or k == len(runs) - 1:
                continue
            if runs[k - 1][2] and runs[k + 1][2] and (e - s) < min_gap:
                out[s:e] = True
                changed = True
        if not changed:
            break

    # Pass 2: drop short split bursts
    runs = _runs(out)
    for s, e, is_split in runs:
        if is_split and (e - s) < min_split:
            out[s:e] = False

    before = int(mask.sum())
    after = int(out.sum())
    if before != after:
        print(
            f"[LAYOUT] stabilize mask: split frames {before}→{after} "
            f"(min_split={min_split_sec:.1f}s min_gap={min_mono_gap_sec:.1f}s)",
            flush=True,
        )
    return out


def preflight_split_segments(
    video_path: str,
    start: float,
    end: float,
    out_fps: float,
    mask: np.ndarray,
    init_positions: list[dict] | None = None,
    verify_window_sec: float = 0.55,
    min_verify_hits: int = 2,
) -> tuple[np.ndarray, np.ndarray | None, np.ndarray | None]:
    """
    Avant d'armer chaque fenêtre split : vérifier que l'image est un vrai 2-shot,
    puis figer les centres L/R pour TOUT le segment (1ère → dernière frame).

    Retourne (mask_affiné, lock_top[N,2], lock_bot[N,2]).
    lock_* = None si aucun segment valide.
    """
    n = len(mask)
    if n == 0 or out_fps <= 0:
        return mask, None, None

    fallback_left = (0.33, 0.4)
    fallback_right = (0.67, 0.4)
    if init_positions and len(init_positions) >= 2:
        a = (float(init_positions[0]["cx"]), float(init_positions[0]["cy"]))
        b = (float(init_positions[1]["cx"]), float(init_positions[1]["cy"]))
        if a[0] <= b[0]:
            fallback_left, fallback_right = a, b
        else:
            fallback_left, fallback_right = b, a

    # Runs True dans le mask brut
    runs: list[tuple[int, int]] = []
    i = 0
    while i < n:
        if not mask[i]:
            i += 1
            continue
        j = i + 1
        while j < n and mask[j]:
            j += 1
        runs.append((i, j))
        i = j

    if not runs:
        return mask, None, None

    # Banque ffmpeg : OpenCV POS_FRAMES droppait tous les runs sur Railway
    # (seek faux → assess_split_clean=solo → armed=0 → effective mono).
    bank = _load_frame_bank(
        video_path,
        start,
        end,
        interval_sec=0.12,
        max_frames=400,
        label="LAYOUT",
    )
    out_mask = mask.copy()
    lock_top = np.full((n, 2), np.nan, dtype=np.float64)
    lock_bot = np.full((n, 2), np.nan, dtype=np.float64)
    verify_frames = max(2, int(round(verify_window_sec * out_fps)))
    armed = 0
    dropped = 0
    trimmed = 0

    def _read_out_frame(out_i: int) -> np.ndarray | None:
        t_abs = start + (out_i / out_fps if out_fps > 0 else 0.0)
        return bank.nearest(t_abs)

    for s, e in runs:
        # Streak consécutif de frames propices → arme. Sinon drop le run.
        arm_at: int | None = None
        pair_samples: list[tuple[tuple[float, float], tuple[float, float]]] = []
        streak = 0
        streak_start = s
        # Ne scanner que la 1re seconde faisait tomber tout un plan de 10s dont
        # l'entrée était sale (cut, flou de bougé, transition) — faux négatif
        # split n°1. On cherche plus loin (3s) mais par sondes espacées : moins
        # de seeks H.264 qu'avant (~25 sondes contre 36 frames consécutives), et
        # 2 sondes consécutives à 0.12s d'écart est un signal plus robuste que
        # 2 frames adjacentes. L'extension arrière rattrape ce qui est trimé.
        probe_step = max(1, int(round(0.12 * out_fps)))
        scan_limit = min(e, s + max(verify_frames * 2, int(round(3.0 * out_fps))))
        for fi in range(s, scan_limit, probe_step):
            fr = _read_out_frame(fi)
            if fr is None:
                streak = 0
                pair_samples = []
                continue
            result = assess_split_clean(fr)
            if not result.clean or result.pair is None:
                streak = 0
                pair_samples = []
                continue
            if streak == 0:
                streak_start = fi
                pair_samples = []
            left, right, _al, _ar = result.pair
            pair_samples.append((left, right))
            streak += 1
            if streak >= min_verify_hits:
                arm_at = streak_start
                break

        if arm_at is None or len(pair_samples) < min_verify_hits:
            out_mask[s:e] = False
            dropped += 1
            continue

        if arm_at > s:
            out_mask[s:arm_at] = False
            trimmed += arm_at - s

        # Médiane des samples vérifiés → lock figé pour le segment (1ère→dernière)
        xs_l = [p[0][0] for p in pair_samples]
        ys_l = [p[0][1] for p in pair_samples]
        xs_r = [p[1][0] for p in pair_samples]
        ys_r = [p[1][1] for p in pair_samples]
        left_lock = (float(np.median(xs_l)), float(np.median(ys_l)))
        right_lock = (float(np.median(xs_r)), float(np.median(ys_r)))
        if abs(right_lock[0] - left_lock[0]) < SPLIT_MIN_CENTER_SEP:
            left_lock, right_lock = fallback_left, fallback_right

        # Respecte l'ordre top/bottom des face_positions init (gate serveur).
        top_is_left = True
        if init_positions and len(init_positions) >= 2:
            top_is_left = float(init_positions[0]["cx"]) <= float(init_positions[1]["cx"])
        if top_is_left:
            top_lock, bot_lock = left_lock, right_lock
        else:
            top_lock, bot_lock = right_lock, left_lock

        # Étendre AVANT/APRÈS tant que le plan reste clean : même frame 10s → split 10s.
        # Le mask enter/exit coupait souvent à ~3s ; on commit tout le run clean.
        step = max(1, int(round(0.25 * out_fps)))
        unclean_streak = 0
        seg_start = arm_at
        # backward
        fi = arm_at - step
        while fi >= 0:
            fr = _read_out_frame(fi)
            if fr is None:
                break
            if assess_split_clean(fr).clean:
                seg_start = fi
                unclean_streak = 0
                fi -= step
            else:
                unclean_streak += 1
                if unclean_streak >= 2:
                    break
                fi -= step
        unclean_streak = 0
        seg_end = e
        # forward past original mask end while still clean
        fi = e
        while fi < n:
            fr = _read_out_frame(fi)
            if fr is None:
                break
            if assess_split_clean(fr).clean:
                seg_end = min(n, fi + step)
                unclean_streak = 0
                fi += step
            else:
                unclean_streak += 1
                if unclean_streak >= 2:
                    break
                fi += step

        if seg_start < arm_at:
            out_mask[seg_start:arm_at] = True
        if seg_end > e:
            out_mask[e:seg_end] = True

        for fi in range(seg_start, seg_end):
            lock_top[fi, 0] = top_lock[0]
            lock_top[fi, 1] = top_lock[1]
            lock_bot[fi, 0] = bot_lock[0]
            lock_bot[fi, 1] = bot_lock[1]
        armed += 1
        print(
            f"[LAYOUT] preflight commit shot: frames {seg_start}→{seg_end} "
            f"({(seg_end - seg_start) / max(out_fps, 1):.1f}s) lock L/R frozen",
            flush=True,
        )

    # Re-stabilize après trim/drop — gap mono large pour ne pas recouper un plan 10s.
    out_mask = _stabilize_layout_mask(out_mask, out_fps, min_split_sec=2.0, min_mono_gap_sec=2.5)

    # Après stabilize : combler / dropper les runs sans lock (gaps recollés).
    i = 0
    while i < n:
        if not out_mask[i]:
            lock_top[i, :] = np.nan
            lock_bot[i, :] = np.nan
            i += 1
            continue
        j = i + 1
        while j < n and out_mask[j]:
            j += 1
        finite = [k for k in range(i, j) if np.isfinite(lock_top[k, 0])]
        if not finite:
            out_mask[i:j] = False
            lock_top[i:j, :] = np.nan
            lock_bot[i:j, :] = np.nan
        else:
            # Propager le lock médian du segment sur tout le run (1ère→dernière).
            top = (
                float(np.median(lock_top[finite, 0])),
                float(np.median(lock_top[finite, 1])),
            )
            bot = (
                float(np.median(lock_bot[finite, 0])),
                float(np.median(lock_bot[finite, 1])),
            )
            for k in range(i, j):
                lock_top[k, 0] = top[0]
                lock_top[k, 1] = top[1]
                lock_bot[k, 0] = bot[0]
                lock_bot[k, 1] = bot[1]
        i = j

    has_lock = bool(np.isfinite(lock_top).any())
    print(
        f"[LAYOUT] preflight split: armed={armed} dropped={dropped} trimmed_frames={trimmed} "
        f"split={int(out_mask.sum())}/{n}",
        flush=True,
    )
    if not has_lock:
        return out_mask, None, None
    return out_mask, lock_top, lock_bot


def build_dynamic_layout_mask(
    video_path: str,
    start: float,
    end: float,
    out_fps: float,
    clip_frames_out: int,
    sample_interval_sec: float = 0.50,
    enter_ratio: float = 0.62,
    exit_ratio: float = 0.35,
    min_hold_sec: float = 3.0,
    min_exit_hold_sec: float = 1.0,
    window_sec: float = 2.0,
    clear_mono_ratio: float = 0.12,
    clear_mono_hold_sec: float = 1.15,
) -> np.ndarray:
    """
    Timeline bool par frame de sortie : True = split, False = normal (smart-crop).

    Échantillonne les visages le long du clip. Passe en split seulement si une
    fenêtre glissante a assez de frames à 2 visages séparés ; revient en normal
    si les gens sont de dos / hors champ (hystérésis + durée mini entre switches).

    `clear_mono_ratio` : sortie anticipée si la fenêtre est clairement mono
    (une seule tête) — évite de rester en split sur un gros plan solo.
    `min_hold_sec` : délai mini avant d'ENTRER en split.
    `min_exit_hold_sec` : délai mini avant sortie soft (exit_ratio) — plus court
    que enter pour lâcher vite un cut POV solo.
    """
    duration = max(0.1, end - start)
    samples: list[tuple[float, bool, str, float]] = []  # (t, clean, reason, dist)
    bank = _load_frame_bank(
        video_path,
        start,
        end,
        interval_sec=sample_interval_sec,
        max_frames=360,
        label="LAYOUT",
    )
    t = 0.0
    while t < duration:
        frame = bank.nearest(start + t)
        if frame is not None:
            # Check propice externalisé (wide_table / eyes / soft_sep).
            clean = assess_split_clean(frame)
            samples.append((t, clean.clean, clean.reason, clean.dist))
        else:
            samples.append((t, False, "read_fail", 0.0))
        t += sample_interval_sec

    if not samples:
        return np.zeros(clip_frames_out, dtype=bool)

    clean_hits = sum(1 for s in samples if s[1])
    reason_counts: dict[str, int] = {}
    for _, is_c, reason, _d in samples:
        if is_c:
            reason_counts[reason] = reason_counts.get(reason, 0) + 1
    print(
        f"[LAYOUT] split_clean samples: {clean_hits}/{len(samples)} clean "
        f"reasons={reason_counts or '{}'}",
        flush=True,
    )

    # Commit par plan clean continu : même plan 10s → split 10s (pas 3s puis mono).
    # Remplace l'ancienne machine enter/exit qui sortait trop tôt sur un miss.
    _ = (enter_ratio, exit_ratio, min_exit_hold_sec, window_sec, clear_mono_ratio)  # legacy kwargs
    sample_clean = np.array([1 if s[1] else 0 for s in samples], dtype=np.int8)
    sample_t = np.array([s[0] for s in samples], dtype=np.float64)
    # 1 miss isolé entre deux clean = bruit, pas un vrai solo.
    for k in range(1, len(sample_clean) - 1):
        if sample_clean[k] == 0 and sample_clean[k - 1] == 1 and sample_clean[k + 1] == 1:
            sample_clean[k] = 1

    frame_clean = np.zeros(clip_frames_out, dtype=bool)
    for i in range(clip_frames_out):
        t_i = i / out_fps if out_fps > 0 else 0.0
        j = int(np.argmin(np.abs(sample_t - t_i))) if len(sample_t) else 0
        frame_clean[i] = bool(sample_clean[j]) if len(sample_clean) else False

    # Comble trous mono courts (≤1.8s) à l'intérieur d'un même plan clean.
    gap_fill = max(1, int(round(1.8 * out_fps)))
    out = frame_clean.copy()
    i = 0
    while i < clip_frames_out:
        if out[i]:
            i += 1
            continue
        j = i + 1
        while j < clip_frames_out and not out[j]:
            j += 1
        if i > 0 and j < clip_frames_out and out[i - 1] and out[j] and (j - i) <= gap_fill:
            out[i:j] = True
        i = j

    # Drop seulement les micro-bursts ; un vrai plan clean long reste entier.
    min_split = max(1, int(round(max(2.0, float(min_hold_sec) * 0.5) * out_fps)))
    i = 0
    while i < clip_frames_out:
        if not out[i]:
            i += 1
            continue
        j = i + 1
        while j < clip_frames_out and out[j]:
            j += 1
        if (j - i) < min_split:
            out[i:j] = False
        i = j

    mask = out
    split_frames = int(mask.sum())
    print(
        f"[LAYOUT] dynamic mask commit-clean: {split_frames}/{clip_frames_out} frames split "
        f"({100 * split_frames / max(1, clip_frames_out):.0f}%), "
        f"samples={len(samples)} clean={clean_hits} "
        f"min_split={min_split / max(out_fps, 1):.1f}s gap_fill={gap_fill / max(out_fps, 1):.1f}s",
        flush=True,
    )
    return mask


def _build_ffmpeg_raw_pipe_cmd(
    out_w: int,
    out_h: int,
    out_fps: float,
    audio_path: str,
    audio_start: float,
    audio_duration: float,
    output_path: str,
) -> list[str]:
    x264_preset = os.environ.get("RENDER_LIBX264_PRESET", "veryfast").strip() or "veryfast"
    # Défaut 2 (pas 0=auto) : sur Railway Hobby, 2 encodes × N CPU → "Error while opening encoder".
    x264_threads = os.environ.get("RENDER_LIBX264_THREADS", "2").strip() or "2"
    x264_crf = os.environ.get("RENDER_LIBX264_CRF", "20").strip() or "20"
    # Audio export : 192k stéréo 48 kHz (même qualité free/paid). Override RENDER_AUDIO_BITRATE.
    # (Ancien défaut 320k ; 192k sans -ac/-ar sonnait plat — ar/ac sont fixés ci-dessous.)
    audio_bitrate = os.environ.get("RENDER_AUDIO_BITRATE", "192k").strip() or "192k"
    return [
        "ffmpeg", "-y",
        "-f", "rawvideo",
        "-vcodec", "rawvideo",
        "-s", f"{out_w}x{out_h}",
        "-pix_fmt", "bgr24",
        "-r", f"{out_fps:.6f}".rstrip("0").rstrip("."),
        "-i", "pipe:0",
        "-ss", str(audio_start),
        "-t", str(audio_duration),
        "-i", audio_path,
        "-map", "0:v",
        "-map", "1:a:0?",
        "-c:v", "libx264",
        "-preset", x264_preset,
        "-crf", x264_crf,
        "-pix_fmt", "yuv420p",
        "-threads", x264_threads,
        "-c:a", "aac",
        "-b:a", audio_bitrate,
        "-ar", "48000",
        "-ac", "2",
        "-profile:a", "aac_low",
        "-shortest",
        "-movflags", "+faststart",
        output_path,
    ]


def _spawn_ffmpeg_pipe(cmd: list[str]) -> tuple[subprocess.Popen, list[bytes], threading.Thread]:
    """Lance ffmpeg et vérifie qu'il n'est pas mort au démarrage (encoder OOM)."""
    stderr_chunks: list[bytes] = []
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    stderr_thread = threading.Thread(
        target=_drain_subprocess_stderr,
        args=(proc, stderr_chunks),
        daemon=True,
    )
    stderr_thread.start()
    # Laisse libx264 s'initialiser ; si l'encodeur échoue, poll() != None tout de suite.
    time.sleep(0.25)
    if proc.poll() is not None:
        stderr_thread.join(timeout=5)
        err = b"".join(stderr_chunks).decode("utf-8", errors="replace")
        raise RuntimeError(f"ffmpeg exited early (code={proc.returncode}): {err[-2000:]}")
    return proc, stderr_chunks, stderr_thread


def _resolve_font_path(font_arg: str | None) -> str:
    script_dir = Path(__file__).parent
    font_path = font_arg or str(script_dir / "fonts" / "Montserrat-Black.ttf")
    if not os.path.exists(font_path):
        font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
    if not os.path.exists(font_path):
        font_path = "/System/Library/Fonts/Helvetica.ttc"
    return font_path


def _load_blocks_for_clip(transcription: dict, start: float, end: float, style: str, video_path: str | None):
    words = get_words_in_range(transcription, start, end)
    if not words:
        return []
    if style == "impact":
        blocks = group_into_blocks(words, max_per_block=2, min_block_duration=0.45)
    elif style == "minimal":
        # Phrases plus longues — caption podcast, pas du word-by-word
        blocks = group_into_blocks(words, max_per_block=6, min_block_duration=0.9)
    else:
        blocks = group_into_blocks(words, max_per_block=3, min_block_duration=0.35)
    if video_path and os.path.exists(video_path):
        va = compute_voice_activity(video_path, start, end - start)
        if va is not None:
            snap_blocks_to_voice(blocks, *va)
            print(f"[VAD] blocs recalés sur l'activité vocale ({len(blocks)} blocs)", flush=True)
        else:
            print("[VAD] audio indisponible — timings Whisper conservés", flush=True)
    else:
        print(f"[SUBS] {len(blocks)} blocs / {len(words)} mots (start={start:.2f} end={end:.2f})", flush=True)
    # Après VAD : coupe les blocs encore trop longs (silence / Whisper étiré)
    before = len(blocks)
    clamp_block_display_duration(blocks)
    long_cut = sum(
        1
        for b in blocks
        if float(b.get("bloc_end", 0) or 0) - float(b.get("bloc_start", 0) or 0)
        >= _MAX_BLOCK_DISPLAY_SEC - 0.01
    )
    if long_cut:
        print(
            f"[SUBS] max display {_MAX_BLOCK_DISPLAY_SEC:.1f}s — "
            f"{long_cut}/{before} blocs au plafond",
            flush=True,
        )
    return blocks


def _resolve_output_dims(args) -> tuple[int, int]:
    """CLI --out-width/--out-height, sinon 1080×1920 (ou 1080×1080 en 1:1)."""
    is_square = getattr(args, "format", "9:16") == "1:1"
    default_w, default_h = (1080, 1080) if is_square else (1080, 1920)
    ow = getattr(args, "out_width", None)
    oh = getattr(args, "out_height", None)
    out_w = int(ow) if ow is not None and int(ow) > 0 else default_w
    out_h = int(oh) if oh is not None and int(oh) > 0 else default_h
    return out_w, out_h


def render_base_video_with_subtitles(args) -> None:
    """Overlay subtitles on an already-formatted clean clip (no smart-crop / face detect)."""
    out_w, out_h = _resolve_output_dims(args)
    font_path = _resolve_font_path(args.font)

    with open(args.transcription_path, "r", encoding="utf-8") as f:
        transcription = json.load(f)

    cap = cv2.VideoCapture(args.video_path)
    fps_src = float(cap.get(cv2.CAP_PROP_FPS) or 30)
    src_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or out_w)
    src_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or out_h)
    # Reburn : si dims CLI absentes, coller à la résolution du clean base.
    if getattr(args, "out_width", None) is None and src_w > 0:
        out_w = src_w
    if getattr(args, "out_height", None) is None and src_h > 0:
        out_h = src_h
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    clip_duration = total_frames / fps_src if total_frames > 0 and fps_src > 0 else max(0.1, args.end - args.start)
    # Clip-relative transcription: words already timed from 0
    start = 0.0
    end = clip_duration
    blocks = _load_blocks_for_clip(transcription, start, end, args.style, args.video_path)

    stride = 1
    max_out_env = os.environ.get("RENDER_MAX_OUTPUT_FPS", "30").strip()
    if max_out_env.lower() in ("full", "source", "off", "0", "false"):
        max_out_env = ""
    if max_out_env:
        try:
            target = float(max_out_env)
            if target > 0 and target < fps_src - 0.01:
                stride = max(1, int(round(fps_src / target)))
        except ValueError:
            pass
    out_fps = fps_src / stride
    clip_frames_out = int(clip_duration * out_fps)

    ffmpeg_cmd = _build_ffmpeg_raw_pipe_cmd(
        out_w, out_h, out_fps, args.video_path, 0.0, clip_duration, args.output_path
    )
    print("[BASE-VIDEO] reburn subtitles only — no smart-crop", flush=True)
    print("FFMPEG_CMD:", " ".join(ffmpeg_cmd), flush=True)

    need_resize = src_w != out_w or src_h != out_h
    t0 = time.monotonic()
    proc = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    stderr_chunks: list[bytes] = []
    stderr_thread = threading.Thread(
        target=_drain_subprocess_stderr,
        args=(proc, stderr_chunks),
        daemon=True,
    )
    stderr_thread.start()

    overlay_cache_key = None
    overlay_cache_img = None
    overlay_cache_bbox = None

    hook_text = (getattr(args, "hook_text", None) or "").strip()
    hook_duration = float(getattr(args, "hook_duration", HOOK_DURATION_DEFAULT) or HOOK_DURATION_DEFAULT)
    hook_overlay = None
    hook_bbox = None
    if hook_text:
        try:
            hook_overlay = render_hook_title_card(out_w, out_h, hook_text, font_path)
            if hook_overlay is not None:
                hook_bbox = overlay_alpha_bbox(hook_overlay)
                print(f"[HOOK] title card {hook_duration:.1f}s — {hook_text[:80]!r}", flush=True)
        except Exception as hook_err:
            # Ne jamais faire échouer les sous-titres à cause du bandeau
            print(f"[HOOK] render failed (subs continue): {hook_err}", flush=True)
            hook_overlay = None
            hook_bbox = None

    for i in range(clip_frames_out):
        if stride > 1 and i > 0:
            for _ in range(stride - 1):
                cap.read()
        ret, frame = cap.read()
        if not ret:
            break
        if need_resize:
            frame = cv2.resize(frame, (out_w, out_h), interpolation=cv2.INTER_AREA)

        t = i / out_fps
        frame = apply_hook_title_if_needed(frame, t, hook_overlay, hook_bbox, hook_duration)
        bloc = bloc_for_display_at(get_bloc_at_with_silence_gate(t, blocks), t)
        active_word = get_word_at(t, bloc) if bloc else None
        if bloc and (active_word or bloc["words"]):
            cache_key = (id(bloc), id(active_word) if active_word is not None else None)
            if cache_key == overlay_cache_key and overlay_cache_img is not None:
                overlay = overlay_cache_img
            else:
                overlay = render_subtitle_frame(
                    out_w, out_h, bloc, active_word, args.style, font_path,
                    layout_mode="normal",
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
            print("FFMPEG_STDERR (broken pipe):", stderr_out[-8000:], flush=True)
            raise

    proc.stdin.close()
    proc.wait()
    stderr_thread.join(timeout=120)
    cap.release()
    print(f"[BASE-VIDEO] DONE in {time.monotonic() - t0:.1f}s", flush=True)
    stderr_out = b"".join(stderr_chunks).decode("utf-8", errors="replace")
    print("FFMPEG_STDERR:", stderr_out[-3000:], flush=True)
    if proc.returncode != 0:
        print("FFMPEG_EXIT_CODE:", proc.returncode, flush=True)
        sys.exit(1)


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
    parser.add_argument(
        "--clean-output",
        type=str,
        default=None,
        help="Écrit aussi un MP4 croppé sans sous-titres (même cadrage)",
    )
    parser.add_argument(
        "--base-video",
        action="store_true",
        help="Overlay sous-titres sur une vidéo déjà formatée (pas de smart-crop)",
    )
    parser.add_argument(
        "--hook-text",
        type=str,
        default=None,
        help="Titre putaclic affiché ~3s au début (bandeau blanc / texte noir)",
    )
    parser.add_argument(
        "--hook-duration",
        type=float,
        default=HOOK_DURATION_DEFAULT,
        help="Durée d'affichage du titre hook en secondes (défaut 3)",
    )
    parser.add_argument(
        "--stream-stack",
        action="store_true",
        help="Layout stream/gaming 9:16 (facecam + gameplay) — isolé du mono/split talk",
    )
    parser.add_argument(
        "--stream-layout",
        type=str,
        default=None,
        help="JSON ROI facecam précomputée {x,y,w,h,corner} pour --stream-stack",
    )
    parser.add_argument(
        "--out-width",
        type=int,
        default=None,
        help="Largeur sortie produit (free 720 / paid 1080). Défaut selon --format.",
    )
    parser.add_argument(
        "--out-height",
        type=int,
        default=None,
        help="Hauteur sortie produit (free 1280 / paid 1920). Défaut selon --format.",
    )
    args = parser.parse_args()

    if args.analyze_faces:
        result = analyze_face_count_for_clip(args.video_path, args.start, args.end)
        print(json.dumps(result, indent=2))
        sys.exit(0)

    if not args.output_path or not args.transcription_path:
        parser.error("output_path et transcription_path sont requis pour le rendu")

    # Stream/gaming: chemin dédié — ne touche jamais au smart-crop mono ni au split podcast.
    if args.stream_stack:
        from stream_layout import render_stream_clip

        render_stream_clip(args)
        return

    if args.base_video:
        render_base_video_with_subtitles(args)
        return

    use_split = args.split_vertical and args.face_positions and os.path.exists(args.face_positions)
    face_positions: list[dict] = []
    if use_split:
        with open(args.face_positions, "r", encoding="utf-8") as f:
            face_positions = json.load(f)
        if not isinstance(face_positions, list) or len(face_positions) < 2:
            use_split = False
            face_positions = []

    out_w, out_h = _resolve_output_dims(args)
    font_path = _resolve_font_path(args.font)

    with open(args.transcription_path, "r", encoding="utf-8") as f:
        transcription = json.load(f)

    blocks = _load_blocks_for_clip(
        transcription, args.start, args.end, args.style, args.video_path
    )

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

    ffmpeg_cmd = _build_ffmpeg_raw_pipe_cmd(
        out_w, out_h, out_fps, args.video_path, args.start, clip_duration, args.output_path
    )
    clean_ffmpeg_cmd = None
    if args.clean_output:
        clean_ffmpeg_cmd = _build_ffmpeg_raw_pipe_cmd(
            out_w, out_h, out_fps, args.video_path, args.start, clip_duration, args.clean_output
        )

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
    zoom_smooth: np.ndarray | None = None
    layout_split_mask: np.ndarray | None = None
    split_lock_top: np.ndarray | None = None
    split_lock_bot: np.ndarray | None = None
    # Seed mono : seulement une vraie tête (cy haut). Les face_positions « loose »
    # Haar/épaule (cy~0.4+) faisaient zoomer le mono sur le torse.
    seed_center: tuple[float, float] | None = None
    if face_positions and len(face_positions) >= 1:
        try:
            sx = float(face_positions[0]["cx"])
            sy = float(face_positions[0]["cy"])
            if 0.05 <= sx <= 0.95 and 0.05 <= sy <= 0.38:
                seed_center = (sx, sy)
            else:
                print(
                    f"[SMARTCROP] ignore face-positions seed cy={sy:.2f} (likely body)",
                    flush=True,
                )
        except (KeyError, TypeError, ValueError):
            seed_center = None
    t_pass1_start = time.monotonic()
    if need_mono_track:
        print(
            f"[SMARTCROP] source={'proxy' if _smartcrop_path else 'original'} → "
            f"{_smartcrop_path or args.video_path}",
            flush=True,
        )
        if _smartcrop_path:
            cap_sc = cv2.VideoCapture(_smartcrop_path)
            cx_smooth, cy_smooth, zoom_smooth = collect_crop_positions(
                cap_sc, start_pts, clip_frames_full, fps_src, seed_center=seed_center
            )
            cap_sc.release()
            cap.set(cv2.CAP_PROP_POS_FRAMES, start_pts)
        else:
            cx_smooth, cy_smooth, zoom_smooth = collect_crop_positions(
                cap, start_pts, clip_frames_full, fps_src, seed_center=seed_center
            )
    else:
        cap.set(cv2.CAP_PROP_POS_FRAMES, start_pts)

    if hybrid_split:
        # Podcast/interview : entrer strict, sortir vite sur gros plan solo
        # (évite split A+épaule après cut POV).
        is_podcast = args.talk_format == "interview_podcast"
        layout_kwargs = (
            {
                "enter_ratio": 0.48,
                "exit_ratio": 0.28,
                "min_hold_sec": 2.2,
                "min_exit_hold_sec": 0.9,
                "window_sec": 2.0,
                "clear_mono_ratio": 0.30,
                "clear_mono_hold_sec": 0.35,
                "sample_interval_sec": 0.35,
            }
            if is_podcast
            else {
                "enter_ratio": 0.55,
                "exit_ratio": 0.30,
                "min_hold_sec": 2.5,
                "min_exit_hold_sec": 1.0,
                "window_sec": 2.0,
                "clear_mono_ratio": 0.30,
                "clear_mono_hold_sec": 0.35,
                "sample_interval_sec": 0.40,
            }
        )
        print(
            f"[LAYOUT] talk_format={args.talk_format} "
            f"enter={layout_kwargs['enter_ratio']} exit={layout_kwargs['exit_ratio']} "
            f"hold={layout_kwargs['min_hold_sec']} exit_hold={layout_kwargs['min_exit_hold_sec']} "
            f"clear_mono={layout_kwargs['clear_mono_ratio']}/{layout_kwargs['clear_mono_hold_sec']}s",
            flush=True,
        )
        # Même source que le gate (proxy) : le master 1080p divergait → mask vide
        # → « gated split → effective mono » alors que l'analyse proxy était OK.
        layout_video = (
            args.proxy_path
            if (args.proxy_path and os.path.exists(args.proxy_path))
            else args.video_path
        )
        print(f"[LAYOUT] mask/preflight source={layout_video}", flush=True)
        layout_split_mask = build_dynamic_layout_mask(
            layout_video,
            args.start,
            args.end,
            out_fps,
            clip_frames_out,
            **layout_kwargs,
        )
        # Vérifie chaque fenêtre AVANT d'armer, puis fige L/R pour tout le segment.
        if layout_split_mask is not None and bool(layout_split_mask.any()):
            layout_split_mask, split_lock_top, split_lock_bot = preflight_split_segments(
                layout_video,
                args.start,
                args.end,
                out_fps,
                layout_split_mask,
                init_positions=face_positions,
            )
        # Gate a pu se tromper (fantôme Haar). Sans fenêtre 2-shot réelle → mono
        # smart-crop plutôt qu'un full-clip split fantôme.
        if layout_split_mask is not None and not bool(layout_split_mask.any()):
            print(
                "[LAYOUT] no hybrid two-shot windows — fallback mono smart-crop (no full-clip split)",
                flush=True,
            )
            split_lock_top = None
            split_lock_bot = None

    t_pass1_end = time.monotonic()
    print(
        f"[TIMING] pass1 (smart-crop + layout) {t_pass1_end - t_pass1_start:.1f}s "
        f"(mono_track={'ON' if need_mono_track else 'OFF'} hybrid_split={'ON' if hybrid_split else 'OFF'})",
        flush=True,
    )

    print(
        f"[RENDER] pass 2 — {clip_frames_out} frames @ {out_fps:.2f}fps (subtitles + pipe → ffmpeg)"
        + (" + clean base" if clean_ffmpeg_cmd else ""),
        flush=True,
    )

    t_pass2_start = time.monotonic()
    # Main d'abord (health-check), puis clean — évite 2× libx264 qui échouent
    # ensemble sous charge ("Error while opening encoder" → BrokenPipe → no-subs).
    try:
        proc, stderr_chunks, stderr_thread = _spawn_ffmpeg_pipe(ffmpeg_cmd)
    except RuntimeError as enc_err:
        print(f"[RENDER] ffmpeg main failed to start: {enc_err}", flush=True)
        raise

    clean_proc = None
    clean_stderr_chunks: list[bytes] = []
    clean_stderr_thread = None
    if clean_ffmpeg_cmd:
        print("FFMPEG_CLEAN_CMD:", " ".join(clean_ffmpeg_cmd), flush=True)
        try:
            clean_proc, clean_stderr_chunks, clean_stderr_thread = _spawn_ffmpeg_pipe(clean_ffmpeg_cmd)
        except RuntimeError as clean_err:
            # Clean optionnel : on continue le rendu sous-titré sans base reburn.
            print(f"[CLEAN] ffmpeg failed to start (continue without clean): {clean_err}", flush=True)
            clean_proc = None
            clean_stderr_chunks = []
            clean_stderr_thread = None

    prev_split_top: tuple[float, float] | None = None
    prev_split_bottom: tuple[float, float] | None = None
    # Après sortie split → mono : track pré-figé (preflight), pas de refine runtime.
    was_split = False
    mono_blend_left = 0
    mono_blend_total = 0

    # Cache de l'overlay sous-titre : le bloc/mot actif reste souvent identique
    # sur plusieurs frames consécutives (ex. ~10 frames à 30fps pour un mot tenu
    # 0.3s) — recalculer le rendu PIL (texte + contour + ombre) à chaque frame
    # est le principal poste CPU du pipeline pour rien tant que rien n'a changé.
    overlay_cache_key: tuple[int, int | None] | None = None
    overlay_cache_img: np.ndarray | None = None
    overlay_cache_bbox: tuple[int, int, int, int] | None = None

    hook_text = (getattr(args, "hook_text", None) or "").strip()
    hook_duration = float(getattr(args, "hook_duration", HOOK_DURATION_DEFAULT) or HOOK_DURATION_DEFAULT)
    hook_overlay = None
    hook_bbox = None
    if hook_text:
        try:
            hook_overlay = render_hook_title_card(out_w, out_h, hook_text, font_path)
            if hook_overlay is not None:
                hook_bbox = overlay_alpha_bbox(hook_overlay)
                print(f"[HOOK] title card {hook_duration:.1f}s — {hook_text[:80]!r}", flush=True)
        except Exception as hook_err:
            # Ne jamais faire échouer les sous-titres à cause du bandeau
            print(f"[HOOK] render failed (subs continue): {hook_err}", flush=True)
            hook_overlay = None
            hook_bbox = None

    area_top = float(face_positions[0]["area"]) if len(face_positions) > 0 and "area" in face_positions[0] else None
    area_bottom = float(face_positions[1]["area"]) if len(face_positions) > 1 and "area" in face_positions[1] else None

    rendered_split_frames = 0
    rendered_total_frames = 0

    for i in range(clip_frames_out):
        if stride > 1 and i > 0:
            for _ in range(stride - 1):
                cap.read()
        ret, frame = cap.read()
        if not ret:
            break

        src_idx = min(i * stride, clip_frames_full - 1) if clip_frames_full > 0 else i
        t = i / out_fps
        mask_i = min(i, len(layout_split_mask) - 1) if layout_split_mask is not None else -1
        # Trust le mask preflight uniquement — plus de force_split / solo_force runtime
        # (c'était la source des bascules split↔mono pendant un segment).
        frame_is_split = bool(hybrid_split and mask_i >= 0 and layout_split_mask[mask_i])

        if frame_is_split:
            use_top: tuple[float, float] | None = None
            use_bot: tuple[float, float] | None = None
            if (
                split_lock_top is not None
                and split_lock_bot is not None
                and mask_i < len(split_lock_top)
                and np.isfinite(split_lock_top[mask_i, 0])
                and np.isfinite(split_lock_bot[mask_i, 0])
            ):
                use_top = (float(split_lock_top[mask_i, 0]), float(split_lock_top[mask_i, 1]))
                use_bot = (float(split_lock_bot[mask_i, 0]), float(split_lock_bot[mask_i, 1]))
            else:
                # Filet : vérifier cette frame avant de splitter (jamais inventer).
                pair = assess_split_clean(frame).pair
                if pair is not None:
                    left, right, _al, _ar = pair
                    top_is_left = True
                    if len(face_positions) >= 2:
                        top_is_left = float(face_positions[0]["cx"]) <= float(face_positions[1]["cx"])
                    use_top, use_bot = (left, right) if top_is_left else (right, left)
                elif prev_split_top is not None and prev_split_bottom is not None:
                    use_top, use_bot = prev_split_top, prev_split_bottom

            if use_top is None or use_bot is None:
                frame_is_split = False
            else:
                prev_split_top, prev_split_bottom = use_top, use_bot
                frame = resize_and_crop_split_frame(
                    frame,
                    use_top,
                    use_bot,
                    out_w=out_w,
                    out_h=out_h,
                    area_top=area_top,
                    area_bottom=area_bottom,
                )
                was_split = True
                mono_blend_left = 0

        rendered_total_frames += 1
        if frame_is_split:
            rendered_split_frames += 1

        if not frame_is_split:
            if cx_smooth is not None and cy_smooth is not None:
                track_cx = float(cx_smooth[src_idx])
                track_cy = float(cy_smooth[src_idx])
                track_zoom = (
                    float(zoom_smooth[src_idx])
                    if zoom_smooth is not None and src_idx < len(zoom_smooth)
                    else MONO_FACE_ZOOM
                )
                if was_split:
                    was_split = False
                # Preflight a figé le lock — pas de refine runtime (évite G/D).
                frame = resize_and_crop_frame(
                    frame, out_w, out_h, (track_cx, track_cy), zoom=track_zoom
                )
            else:
                frame = resize_and_crop_frame(frame, out_w, out_h, None)
                was_split = False
                mono_blend_left = 0

        # Base clean = même cadrage, avant overlay sous-titres / titre hook
        if clean_proc is not None and clean_proc.stdin is not None:
            try:
                clean_proc.stdin.write(np.ascontiguousarray(frame).tobytes())
            except BrokenPipeError:
                print("[CLEAN] broken pipe — continue without clean base", flush=True)
                try:
                    clean_proc.stdin.close()
                except Exception:
                    pass
                clean_proc = None

        frame = apply_hook_title_if_needed(frame, t, hook_overlay, hook_bbox, hook_duration)

        bloc = bloc_for_display_at(get_bloc_at_with_silence_gate(t, blocks), t)
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

    clean_ok = False
    if clean_proc is not None:
        try:
            if clean_proc.stdin and not clean_proc.stdin.closed:
                clean_proc.stdin.close()
        except Exception:
            pass
        clean_proc.wait()
        if clean_stderr_thread:
            clean_stderr_thread.join(timeout=120)
        clean_ok = clean_proc.returncode == 0
        clean_stderr = b"".join(clean_stderr_chunks).decode("utf-8", errors="replace")
        print("FFMPEG_CLEAN_STDERR:", clean_stderr[-2000:], flush=True)
        if not clean_ok:
            print(f"[CLEAN] ffmpeg exit {clean_proc.returncode} — clean base skipped", flush=True)
            try:
                if args.clean_output and os.path.exists(args.clean_output):
                    os.unlink(args.clean_output)
            except OSError:
                pass
        else:
            print(f"[CLEAN] written → {args.clean_output}", flush=True)

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

    # Mode effectif = ce qui a vraiment été encodé (pas le gate serveur).
    # Le hybrid peut ouvrir --split-vertical puis tout dropper → mono pur.
    split_ratio = (
        rendered_split_frames / rendered_total_frames if rendered_total_frames > 0 else 0.0
    )
    effective_mode = "split_vertical" if split_ratio >= 0.05 else "normal"
    print(
        f"[LAYOUT] effective_mode={effective_mode} "
        f"split_frames={rendered_split_frames}/{rendered_total_frames} "
        f"ratio={split_ratio:.3f} gated_split={1 if use_split else 0}",
        flush=True,
    )

    stderr_out = b"".join(stderr_chunks).decode("utf-8", errors="replace")
    print("FFMPEG_STDERR:", stderr_out[-3000:], flush=True)

    if proc.returncode != 0:
        print("FFMPEG_EXIT_CODE:", proc.returncode, flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
