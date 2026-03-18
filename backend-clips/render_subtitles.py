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
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

EMOJI_REGEX = re.compile(
    r"[\U0001F300-\U0001F9FF\U00002600-\U000026FF\U00002700-\U000027BF]"
)

# Style Reese's / MrBeast : contour noir uniforme, mot actif coloré
STYLE_COLORS = {
    "karaoke": {"active": "#FFD700", "inactive": "#FFFFFF", "contour": "#000000"},
    "highlight": {"active": "#FFE500", "inactive": "#FFFFFF", "contour": "#000000"},
    "minimal": {"active": "#FFFFFF", "inactive": "#FFFFFF", "contour": "#000000"},
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


def group_into_blocks(words: list, max_per_block: int = 4) -> list:
    """Groupe les mots en blocs de 3-4."""
    blocks = []
    for i in range(0, len(words), max_per_block):
        chunk = words[i : i + max_per_block]
        if chunk:
            blocks.append({
                "words": chunk,
                "bloc_start": chunk[0]["start"],
                "bloc_end": chunk[-1]["end"],
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


def _textlength(draw, text: str, font) -> float:
    try:
        return draw.textlength(text, font=font)
    except TypeError:
        bbox = draw.textbbox((0, 0), text, font=font)
        return bbox[2] - bbox[0]


def render_subtitle_frame(
    width: int,
    height: int,
    bloc: dict,
    active_word: dict | None,
    style: str,
    font_path: str,
) -> np.ndarray:
    """Rendu style Reese's/MrBeast : contour noir uniforme, mot actif coloré, ombre grise 3D. Max 2 lignes."""
    colors = STYLE_COLORS.get(style, STYLE_COLORS["karaoke"])
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    font_size = 85
    font_small = 68
    try:
        font = ImageFont.truetype(font_path, font_size)
        font_small_obj = ImageFont.truetype(font_path, font_small)
    except OSError:
        font = ImageFont.load_default()
        font_small_obj = font

    words_data = bloc["words"]
    line_height = 100

    # Calculer largeur totale et décider 1 ou 2 lignes
    total_width = sum(
        _textlength(draw, w["word"] + " ", font_small_obj if len(w["word"]) > 10 else font)
        for w in words_data
    )
    two_lines = total_width > width * 0.85 and len(words_data) > 1

    if two_lines:
        mid = (len(words_data) + 1) // 2
        lines = [words_data[:mid], words_data[mid:]]
        y_base = height - 280
    else:
        lines = [words_data]
        y_base = height - 220

    for line_idx, line_words in enumerate(lines):
        line_width = sum(
            _textlength(draw, w["word"] + " ", font_small_obj if len(w["word"]) > 10 else font)
            for w in line_words
        )
        x = (width - line_width) / 2
        y = y_base + line_idx * line_height

        for word_obj in line_words:
            word = word_obj["word"]
            is_active = active_word and word == active_word["word"]
            couleur_texte = colors["active"] if is_active else colors["inactive"]
            couleur_contour = colors["contour"]

            f = font_small_obj if len(word) > 10 else font

            # Ombre grise légère (effet 3D)
            draw.text((x + 2, y + 2), word, font=f, fill=(51, 51, 51, 140))

            # Contour noir épais (16 directions circulaires, offset 9px)
            for angle in range(16):
                rad = angle * math.pi / 8
                dx = int(9 * math.cos(rad))
                dy = int(9 * math.sin(rad))
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
    Détecte le centre du visage principal (frontal ou profil).
    Essaie frontal d'abord, puis profil (gauche et droite) si rien.
    """
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    h, w = frame.shape[:2]

    # 1. Frontal
    pos = _detect_with_cascade(_get_frontal_cascade(), gray, w, h)
    if pos is not None:
        return pos

    # 2. Profil gauche (cascade entraîné sur visages tournés à gauche)
    profile = _get_profile_cascade()
    if profile is not None:
        pos = _detect_with_cascade(profile, gray, w, h)
        if pos is not None:
            return pos

        # 3. Profil droit : flip horizontal puis détecter, remapper les coords
        flipped = cv2.flip(gray, 1)
        pos = _detect_with_cascade(profile, flipped, w, h)
        if pos is not None:
            return (1.0 - pos[0], pos[1])  # remapper x

    return None


_last_detected_center: tuple[float, float] | None = None


def get_crop_center_for_frame(
    frame: np.ndarray,
    prev_center: tuple[float, float] | None,
    frame_idx: int = 0,
    smoothing: float = 0.3,
) -> tuple[float, float]:
    """
    Retourne le centre de crop pour cette frame : suivi de la personne.
    Détection espacée (toutes les 15 frames) + smoothing continu à chaque frame.
    """
    global _last_detected_center
    fallback = (0.5, 0.5)
    target = _last_detected_center if _last_detected_center is not None else fallback

    if frame_idx % 15 == 0:
        pos = detect_face_center(frame)
        if pos is not None:
            if _last_detected_center is not None:
                dist = ((pos[0] - _last_detected_center[0]) ** 2 + (pos[1] - _last_detected_center[1]) ** 2) ** 0.5
                if dist <= 0.10:
                    _last_detected_center = pos
                    target = pos
            else:
                _last_detected_center = pos
                target = pos

    if prev_center is not None:
        cx = smoothing * prev_center[0] + (1 - smoothing) * target[0]
        cy = smoothing * prev_center[1] + (1 - smoothing) * target[1]
    else:
        cx, cy = target[0], target[1]
    cy = max(0.25, min(cy, 0.42))
    return (float(cx), float(cy))


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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("video_path", help="Chemin vidéo source")
    parser.add_argument("start", type=float, help="Début du clip (s)")
    parser.add_argument("end", type=float, help="Fin du clip (s)")
    parser.add_argument("output_path", help="Chemin sortie MP4")
    parser.add_argument("transcription_path", help="JSON transcription")
    parser.add_argument("--style", default="karaoke", choices=["karaoke", "highlight", "minimal"])
    parser.add_argument("--format", default="9:16", choices=["9:16", "1:1"])
    parser.add_argument("--font", help="Chemin police TTF")
    parser.add_argument("--smart-crop", action="store_true", help="Crop intelligent centré sur le visage (format vertical)")
    args = parser.parse_args()

    out_w, out_h = (1080, 1080) if args.format == "1:1" else (1080, 1920)

    script_dir = Path(__file__).parent
    font_path = args.font or str(script_dir / "fonts" / "Anton-Regular.ttf")
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
        blocks = group_into_blocks(words, 4)

    cap = cv2.VideoCapture(args.video_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    src_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    src_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    clip_duration = args.end - args.start
    clip_frames = int(clip_duration * fps)

    ffmpeg_cmd = [
        "ffmpeg", "-y",
        "-f", "rawvideo",
        "-vcodec", "rawvideo",
        "-s", f"{out_w}x{out_h}",
        "-pix_fmt", "bgr24",
        "-r", str(fps),
        "-i", "pipe:0",
        "-ss", str(args.start),
        "-t", str(clip_duration),
        "-i", args.video_path,
        "-map", "0:v",
        "-map", "1:a",
        "-c:v", "libx264",
        "-preset", "slow",
        "-crf", "15",
        "-c:a", "aac",
        "-b:a", "192k",
        args.output_path,
    ]

    proc = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE)

    start_pts = int(args.start * fps)
    cap.set(cv2.CAP_PROP_POS_FRAMES, start_pts)

    use_smart_crop = args.smart_crop and args.format == "9:16"
    prev_crop_center: tuple[float, float] | None = None
    global _last_detected_center
    _last_detected_center = None

    for i in range(clip_frames):
        ret, frame = cap.read()
        if not ret:
            break

        t = i / fps
        if use_smart_crop:
            crop_center = get_crop_center_for_frame(frame, prev_crop_center, frame_idx=i, smoothing=0.85)
            prev_crop_center = crop_center
        else:
            crop_center = None
        frame = resize_and_crop_frame(frame, out_w, out_h, crop_center)

        bloc = get_bloc_at_or_nearest(t, blocks)
        active_word = get_word_at(t, bloc) if bloc else None

        if bloc and (active_word or bloc["words"]):
            overlay = render_subtitle_frame(
                out_w, out_h, bloc, active_word, args.style, font_path
            )
            frame = blend_overlay(frame, overlay)

        proc.stdin.write(frame.tobytes())

    proc.stdin.close()
    proc.wait()
    cap.release()

    if proc.returncode != 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
