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
import mediapipe as mp
import numpy as np
from scipy.ndimage import gaussian_filter1d
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


# Contour : 4 directions cardinales uniquement, déplacement max 3 px
OUTLINE_OFFSET_PX = 3


def render_subtitle_frame(
    width: int,
    height: int,
    bloc: dict,
    active_word: dict | None,
    style: str,
    font_path: str,
    layout_mode: str = "normal",
) -> np.ndarray:
    """Contour léger, pilule uniquement sur le mot actif, texte actif blanc sur fond coloré. Max 2 lignes."""
    colors = STYLE_COLORS.get(style, STYLE_COLORS["karaoke"])
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    is_split = layout_mode == "split_vertical"
    font_size = 78 if is_split else 92
    font_small = 64 if is_split else 74
    font = _load_title_font(font_path, font_size)
    font_small_obj = _load_title_font(font_path, font_small)

    words_data = bloc["words"]
    line_height = 100

    # Calculer largeur totale et décider 1 ou 2 lignes
    total_width = sum(
        _textlength(draw, w["word"] + " ", font_small_obj if len(w["word"]) > 10 else font)
        for w in words_data
    )
    two_lines = total_width > width * 0.85 and len(words_data) > 1

    safe_bottom = int(height * 0.72)
    if two_lines:
        mid = (len(words_data) + 1) // 2
        lines = [words_data[:mid], words_data[mid:]]
        y_base = safe_bottom - (line_height * 2)
    else:
        lines = [words_data]
        y_base = safe_bottom - line_height

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


_DETECT_INTERVAL: int = 15
_SCENE_CUT_THRESHOLD: float = 0.25
_DEFAULT_CX: float = 0.5
_DEFAULT_CY: float = 0.4
_CY_CLAMP = (0.25, 0.42)


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
            pos = detect_face_center(frame)
            if pos is not None:
                if last_known is not None and abs(pos[0] - last_known[0]) > 0.30:
                    pass
                else:
                    cx_raw[i] = pos[0]
                    cy_raw[i] = pos[1]
                    last_known = (pos[0], pos[1])

        prev_frame = frame

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
        f"cx range [{cx_smooth.min():.2f}, {cx_smooth.max():.2f}]"
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
    min_area_ratio: float = 0.30,
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
    multi_face_threshold: float = 0.65,
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
    parser.add_argument("--style", default="karaoke", choices=["karaoke", "highlight", "minimal"])
    parser.add_argument("--format", default="9:16", choices=["9:16", "1:1"])
    parser.add_argument("--font", help="Chemin police TTF")
    parser.add_argument("--smart-crop", action="store_true", help="Crop intelligent centré sur le visage (format vertical)")
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
        "-movflags", "+faststart",
        args.output_path,
    ]

    proc = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE)

    start_pts = int(args.start * fps)
    use_smart_crop = args.smart_crop and args.format == "9:16" and not use_split

    cx_smooth: np.ndarray | None = None
    cy_smooth: np.ndarray | None = None
    if use_smart_crop:
        cx_smooth, cy_smooth = collect_crop_positions(cap, start_pts, clip_frames, fps)
    else:
        cap.set(cv2.CAP_PROP_POS_FRAMES, start_pts)

    prev_split_top: tuple[float, float] | None = None
    prev_split_bottom: tuple[float, float] | None = None

    for i in range(clip_frames):
        ret, frame = cap.read()
        if not ret:
            break

        t = i / fps
        if use_split:
            center_top, center_bottom = get_split_centers_for_frame(
                frame, prev_split_top, prev_split_bottom, face_positions, i, smoothing=0.85
            )
            prev_split_top, prev_split_bottom = center_top, center_bottom
            frame = resize_and_crop_split_frame(frame, center_top, center_bottom, half_h=960, out_w=1080)
        elif use_smart_crop:
            crop_center = (float(cx_smooth[i]), float(cy_smooth[i]))
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

        proc.stdin.write(frame.tobytes())

    proc.stdin.close()
    proc.wait()
    cap.release()

    if proc.returncode != 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
