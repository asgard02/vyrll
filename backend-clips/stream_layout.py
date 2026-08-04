#!/usr/bin/env python3
"""
Stream / gaming 9:16 layout — facecam panel + gameplay panel.

Completely isolated from talk mono/split smart-crop. Do not import or mutate
face-scoring constants / collect_crop_positions / split helpers from the talk path.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import cv2
import mediapipe as mp
import numpy as np

# Output stack (1080×1920): ~47% cam / ~53% game — matches target stream split
# (facecam gros plan tête+épaules en haut, gameplay en bas, flush, no separator)
OUT_W = 1080
OUT_H = 1920
STREAM_TOP_H = 900  # ~46.9% — cible 45–50%
STREAM_BOTTOM_H = OUT_H - STREAM_TOP_H  # 1020

# Top panel: gros plan streamer (tête + épaules), jamais de crâne coupé.
# Face légèrement sous le centre → air en haut (headroom 5–8 %).
FACE_TOP_ZOOM = 1.10
FACE_ANCHOR_Y = 0.44  # visage un peu sous le milieu du panneau cam
FACE_HEADROOM = 0.07  # ≥7 % d’air libre au-dessus cheveux/casque
# Inset PiP : coupe chrome Twitch / bleed gameplay aux bords
PIP_BORDER_INSET = 0.06
# Au-dessus du centre visage → sommet casque/cheveux (× hauteur bbox face)
_FACE_TOP_EXTENT = 0.72

# Facecam detection (stream-only thresholds — not shared with talk)
_CORNER_FRAC = 0.32  # scan window as fraction of min(side)
_FACE_MIN_AREA = 0.004  # relative to full frame
_FACE_MAX_AREA = 0.12
_MIN_LOCK_HITS = 2
_SAMPLE_COUNT = 9
_GREEN_BONUS = 0.35
_MP_MODEL_PATH = str(Path(__file__).parent / "models" / "blaze_face_short_range.tflite")

_STREAM_MP_DETECTOR = None
_STREAM_MP_ERROR_LOGGED = False

CornerName = str  # "tl" | "tr" | "bl" | "br"


def _get_stream_mp_detector():
    global _STREAM_MP_DETECTOR
    if _STREAM_MP_DETECTOR is None:
        if not os.path.isfile(_MP_MODEL_PATH):
            raise FileNotFoundError(f"BlazeFace model missing: {_MP_MODEL_PATH}")
        base_options = mp.tasks.BaseOptions(
            model_asset_path=_MP_MODEL_PATH,
            delegate=mp.tasks.BaseOptions.Delegate.CPU,
        )
        options = mp.tasks.vision.FaceDetectorOptions(
            base_options=base_options,
            min_detection_confidence=0.40,
            min_suppression_threshold=0.3,
        )
        _STREAM_MP_DETECTOR = mp.tasks.vision.FaceDetector.create_from_options(options)
        print(
            f"[STREAM] BlazeFace init OK model={_MP_MODEL_PATH}",
            file=sys.stderr,
            flush=True,
        )
    return _STREAM_MP_DETECTOR


def _detect_faces_in_bgr(frame: np.ndarray) -> list[tuple[float, float, float, float, float, bool]]:
    """
    Returns list of (cx, cy, area, bw, bh, has_eyes) normalized to the given frame.
    Own detector — does not call talk helpers.
    """
    global _STREAM_MP_ERROR_LOGGED
    if frame is None or frame.size == 0:
        return []
    try:
        detector = _get_stream_mp_detector()
        rgb = np.ascontiguousarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        result = detector.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
    except Exception as err:
        if not _STREAM_MP_ERROR_LOGGED:
            print(f"[STREAM] face detect failed: {err!r}", file=sys.stderr, flush=True)
            _STREAM_MP_ERROR_LOGGED = True
        return []
    if not result.detections:
        return []
    h, w = frame.shape[:2]
    out: list[tuple[float, float, float, float, float, bool]] = []
    for det in result.detections:
        bb = det.bounding_box
        cx = (bb.origin_x + bb.width / 2.0) / w
        cy = (bb.origin_y + bb.height / 2.0) / h
        area = (bb.width / w) * (bb.height / h)
        bw = bb.width / w
        bh = bb.height / h
        has_eyes = False
        kps = det.keypoints
        if kps and len(kps) >= 2:
            ex0, ey0 = float(kps[0].x), float(kps[0].y)
            ex1, ey1 = float(kps[1].x), float(kps[1].y)
            if abs(ex0 - ex1) >= 0.01:
                has_eyes = True
                cx = (ex0 + ex1) / 2.0
                cy = (ey0 + ey1) / 2.0
        out.append((float(cx), float(cy), float(area), float(bw), float(bh), bool(has_eyes)))
    return out


def _corner_windows(w: int, h: int) -> list[tuple[CornerName, int, int, int, int]]:
    side = int(min(w, h) * _CORNER_FRAC)
    side = max(96, min(side, min(w, h)))
    return [
        ("tl", 0, 0, side, side),
        ("tr", w - side, 0, w, side),
        ("bl", 0, h - side, side, h),
        ("br", w - side, h - side, w, h),
    ]


def _green_screen_score(bgr: np.ndarray) -> float:
    """Optional bonus: large homogeneous green region (chroma). Never required."""
    if bgr is None or bgr.size == 0:
        return 0.0
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    # Broad green band
    mask = cv2.inRange(hsv, (35, 40, 40), (95, 255, 255))
    frac = float(np.count_nonzero(mask)) / float(mask.size)
    if frac < 0.12:
        return 0.0
    return min(1.0, (frac - 0.12) / 0.35)


def _roi_from_face(
    corner: CornerName,
    face_cx: float,
    face_cy: float,
    face_bw: float,
    face_bh: float,
) -> dict[str, Any]:
    """Expand a corner face into a webcam-like rectangle flush to that corner."""
    # Typical facecam: face occupies ~50–65% of cam height — keep ROI tight to PiP
    cam_w = float(np.clip(max(face_bw * 2.1, face_bh * 1.85), 0.12, 0.28))
    cam_h = float(np.clip(max(face_bh * 2.0, face_bw * 1.65), 0.16, 0.34))
    if corner == "tl":
        x, y = 0.0, 0.0
    elif corner == "tr":
        x, y = 1.0 - cam_w, 0.0
    elif corner == "bl":
        x, y = 0.0, 1.0 - cam_h
    else:
        x, y = 1.0 - cam_w, 1.0 - cam_h
    # Nudge so face + headroom (casque/cheveux) stay inside ROI
    face_x0 = face_cx - face_bw / 2
    face_y0 = face_cy - face_bh / 2
    head_top = face_cy - _FACE_TOP_EXTENT * face_bh
    pad_top = 0.045  # ~source headroom inside PiP before inset
    if face_x0 < x:
        x = max(0.0, face_x0 - 0.02)
    if face_x0 + face_bw > x + cam_w:
        x = min(1.0 - cam_w, face_x0 + face_bw - cam_w + 0.02)
    if head_top - pad_top < y:
        # Slide / grow upward so headphones aren't flush to PiP top
        y = max(0.0, head_top - pad_top)
        if y + cam_h > 1.0:
            cam_h = min(cam_h, 1.0 - y)
    if face_y0 + face_bh > y + cam_h:
        y = min(1.0 - cam_h, face_y0 + face_bh - cam_h + 0.02)
    return {
        "x": float(np.clip(x, 0.0, 1.0 - cam_w)),
        "y": float(np.clip(y, 0.0, 1.0 - cam_h)),
        "w": cam_w,
        "h": cam_h,
        "corner": corner,
        "face_cx": float(face_cx),
        "face_cy": float(face_cy),
        "face_bw": float(face_bw),
        "face_bh": float(face_bh),
    }


def _score_candidate(
    corner: CornerName,
    area: float,
    has_eyes: bool,
    green: float,
) -> float:
    if area < _FACE_MIN_AREA or area > _FACE_MAX_AREA:
        return -1.0
    score = 1.0 + min(2.0, area * 40.0)
    if has_eyes:
        score += 1.5
    score += green * _GREEN_BONUS
    # Slight preference is unnecessary — all corners equal
    _ = corner
    return score


def detect_facecam_roi(
    frames: list[np.ndarray],
) -> dict[str, Any] | None:
    """
    Detect a stable corner webcam across sample frames.
    Returns {x,y,w,h,corner,confidence} in normalized coords, or None.
    """
    if not frames:
        return None
    votes: dict[CornerName, list[tuple[float, dict[str, Any]]]] = {
        "tl": [],
        "tr": [],
        "bl": [],
        "br": [],
    }
    for frame in frames:
        if frame is None or frame.size == 0:
            continue
        h, w = frame.shape[:2]
        for corner, x0, y0, x1, y1 in _corner_windows(w, h):
            crop = np.ascontiguousarray(frame[y0:y1, x0:x1])
            if crop.size == 0:
                continue
            faces = _detect_faces_in_bgr(crop)
            if not faces:
                continue
            # Best face in this corner window
            faces.sort(key=lambda f: (f[5], f[2]), reverse=True)
            lcx, lcy, larea, lbw, lbh, has_eyes = faces[0]
            # Remap to full-frame normalized
            span_x = (x1 - x0) / w
            span_y = (y1 - y0) / h
            cx = x0 / w + lcx * span_x
            cy = y0 / h + lcy * span_y
            area = larea * span_x * span_y
            bw = lbw * span_x
            bh = lbh * span_y
            green = _green_screen_score(crop)
            score = _score_candidate(corner, area, has_eyes, green)
            if score < 0:
                continue
            roi = _roi_from_face(corner, cx, cy, bw, bh)
            roi["confidence"] = score
            votes[corner].append((score, roi))

    best_corner: CornerName | None = None
    best_list: list[tuple[float, dict[str, Any]]] = []
    for corner, items in votes.items():
        if len(items) > len(best_list) or (
            len(items) == len(best_list)
            and items
            and best_list
            and sum(s for s, _ in items) > sum(s for s, _ in best_list)
        ):
            if items:
                best_corner = corner
                best_list = items

    def _median_roi(items: list[tuple[float, dict[str, Any]]], corner: CornerName, conf_scale: float = 1.0) -> dict[str, Any]:
        xs = [r["x"] for _, r in items]
        ys = [r["y"] for _, r in items]
        ws = [r["w"] for _, r in items]
        hs = [r["h"] for _, r in items]
        fxs = [float(r.get("face_cx", r["x"] + r["w"] * 0.5)) for _, r in items]
        fys = [float(r.get("face_cy", r["y"] + r["h"] * 0.4)) for _, r in items]
        fbws = [float(r.get("face_bw", r["w"] * 0.45)) for _, r in items]
        fbhs = [float(r.get("face_bh", r["h"] * 0.45)) for _, r in items]
        confs = [s for s, _ in items]
        return {
            "x": float(np.median(xs)),
            "y": float(np.median(ys)),
            "w": float(np.median(ws)),
            "h": float(np.median(hs)),
            "face_cx": float(np.median(fxs)),
            "face_cy": float(np.median(fys)),
            "face_bw": float(np.median(fbws)),
            "face_bh": float(np.median(fbhs)),
            "corner": corner,
            "confidence": float(np.mean(confs) * conf_scale),
        }

    if not best_corner or len(best_list) < _MIN_LOCK_HITS:
        # Soft fallback: single strong hit with eyes
        soft: list[tuple[float, dict[str, Any]]] = []
        for items in votes.values():
            soft.extend(items)
        soft.sort(key=lambda t: t[0], reverse=True)
        if soft and soft[0][0] >= 2.5:
            roi = _median_roi([soft[0]], str(soft[0][1].get("corner") or "bl"), conf_scale=0.6)
            print(
                f"[STREAM] facecam soft-lock corner={roi['corner']} "
                f"face=({roi['face_cx']:.2f},{roi['face_cy']:.2f}) "
                f"conf={roi['confidence']:.2f} hits=1",
                flush=True,
            )
            return roi
        print("[STREAM] facecam not found", flush=True)
        return None

    roi = _median_roi(best_list, best_corner)
    print(
        f"[STREAM] facecam lock corner={best_corner} "
        f"roi=({roi['x']:.2f},{roi['y']:.2f},{roi['w']:.2f},{roi['h']:.2f}) "
        f"face=({roi['face_cx']:.2f},{roi['face_cy']:.2f}) "
        f"hits={len(best_list)} conf={roi['confidence']:.2f}",
        flush=True,
    )
    return roi


def _cover_crop_rect(
    src_w: int,
    src_h: int,
    out_w: int,
    out_h: int,
    prefer_cx: float = 0.5,
    prefer_cy: float = 0.5,
) -> tuple[int, int, int, int]:
    """Axis-aligned crop in source that covers out aspect (cover)."""
    ar_out = out_w / out_h
    ar_src = src_w / src_h
    if ar_src > ar_out:
        crop_h = src_h
        crop_w = int(round(src_h * ar_out))
    else:
        crop_w = src_w
        crop_h = int(round(src_w / ar_out))
    cx = int(round(prefer_cx * src_w))
    cy = int(round(prefer_cy * src_h))
    x0 = int(np.clip(cx - crop_w // 2, 0, max(0, src_w - crop_w)))
    y0 = int(np.clip(cy - crop_h // 2, 0, max(0, src_h - crop_h)))
    return x0, y0, crop_w, crop_h


def gameplay_crop_rect(
    frame_w: int,
    frame_h: int,
    facecam_roi: dict[str, Any] | None,
    panel_w: int = OUT_W,
    panel_h: int = STREAM_BOTTOM_H,
) -> tuple[int, int, int, int]:
    """
    Cover-crop for gameplay panel, shifted away from facecam to avoid duplicate cam.
    """
    prefer_cx, prefer_cy = 0.5, 0.45
    if facecam_roi:
        corner = str(facecam_roi.get("corner") or "")
        # Push focus away from the cam corner
        if corner == "tl":
            prefer_cx, prefer_cy = 0.62, 0.55
        elif corner == "tr":
            prefer_cx, prefer_cy = 0.38, 0.55
        elif corner == "bl":
            prefer_cx, prefer_cy = 0.62, 0.40
        elif corner == "br":
            prefer_cx, prefer_cy = 0.38, 0.40

    x0, y0, cw, ch = _cover_crop_rect(
        frame_w, frame_h, panel_w, panel_h, prefer_cx, prefer_cy
    )

    if not facecam_roi:
        return x0, y0, cw, ch

    # If crop still heavily overlaps facecam, shift further
    fx0 = float(facecam_roi["x"]) * frame_w
    fy0 = float(facecam_roi["y"]) * frame_h
    fx1 = fx0 + float(facecam_roi["w"]) * frame_w
    fy1 = fy0 + float(facecam_roi["h"]) * frame_h

    def _overlap_area(a0, b0, aw, ah) -> float:
        ix0 = max(a0, fx0)
        iy0 = max(b0, fy0)
        ix1 = min(a0 + aw, fx1)
        iy1 = min(b0 + ah, fy1)
        return max(0.0, ix1 - ix0) * max(0.0, iy1 - iy0)

    cam_area = max(1.0, (fx1 - fx0) * (fy1 - fy0))
    if _overlap_area(x0, y0, cw, ch) / cam_area > 0.35:
        # Nudge opposite to cam center
        cam_cx = (fx0 + fx1) / 2 / frame_w
        cam_cy = (fy0 + fy1) / 2 / frame_h
        prefer_cx = float(np.clip(0.5 + (0.5 - cam_cx) * 0.9, 0.15, 0.85))
        prefer_cy = float(np.clip(0.5 + (0.5 - cam_cy) * 0.7, 0.20, 0.80))
        x0, y0, cw, ch = _cover_crop_rect(
            frame_w, frame_h, panel_w, panel_h, prefer_cx, prefer_cy
        )
    return x0, y0, cw, ch


def _resize_cover(crop: np.ndarray, out_w: int, out_h: int) -> np.ndarray:
    if crop is None or crop.size == 0:
        return np.zeros((out_h, out_w, 3), dtype=np.uint8)
    h, w = crop.shape[:2]
    scale = max(out_w / w, out_h / h)
    nw = max(out_w, int(round(w * scale)))
    nh = max(out_h, int(round(h * scale)))
    scaled = cv2.resize(crop, (nw, nh), interpolation=cv2.INTER_LANCZOS4)
    x0 = (nw - out_w) // 2
    y0 = (nh - out_h) // 2
    return scaled[y0 : y0 + out_h, x0 : x0 + out_w]


def _pip_pixel_box(
    facecam_roi: dict[str, Any],
    src_w: int,
    src_h: int,
    inset: float = PIP_BORDER_INSET,
) -> tuple[int, int, int, int]:
    """PiP rectangle in pixels, inset to drop Twitch orange border / ornaments."""
    x = float(facecam_roi["x"])
    y = float(facecam_roi["y"])
    w = float(facecam_roi["w"])
    h = float(facecam_roi["h"])
    inset = float(np.clip(inset, 0.0, 0.2))
    x += w * inset
    y += h * inset
    w *= 1.0 - 2.0 * inset
    h *= 1.0 - 2.0 * inset
    fx = int(np.clip(round(x * src_w), 0, max(0, src_w - 2)))
    fy = int(np.clip(round(y * src_h), 0, max(0, src_h - 2)))
    fw = max(16, int(round(w * src_w)))
    fh = max(16, int(round(h * src_h)))
    fw = min(fw, src_w - fx)
    fh = min(fh, src_h - fy)
    return fx, fy, fw, fh


def _pip_fallback_top(frame: np.ndarray, facecam_roi: dict[str, Any]) -> np.ndarray:
    src_h, src_w = frame.shape[:2]
    fx, fy, fw, fh = _pip_pixel_box(facecam_roi, src_w, src_h)
    return _resize_cover(frame[fy : fy + fh, fx : fx + fw], OUT_W, STREAM_TOP_H)


def _face_anchored_top(frame: np.ndarray, facecam_roi: dict[str, Any]) -> np.ndarray:
    """
    Bust framing (head + shoulders) for top panel.

    Hard rules (stream-only):
    - Crop stays inside inset PiP (no Twitch chrome / game bleed).
    - Head never clipped: ≥ FACE_HEADROOM (≈7 %) free above hair/headphones.
    - Face slightly below vertical center (FACE_ANCHOR_Y).
    """
    src_h, src_w = frame.shape[:2]
    pip_x, pip_y, pip_w, pip_h = _pip_pixel_box(facecam_roi, src_w, src_h)
    if pip_w < 16 or pip_h < 16:
        return _pip_fallback_top(frame, facecam_roi)

    face_cx = facecam_roi.get("face_cx")
    face_cy = facecam_roi.get("face_cy")
    if face_cx is None or face_cy is None:
        return _resize_cover(
            frame[pip_y : pip_y + pip_h, pip_x : pip_x + pip_w], OUT_W, STREAM_TOP_H
        )

    face_px = float(np.clip(float(face_cx) * src_w, pip_x + 4, pip_x + pip_w - 4))
    face_py = float(np.clip(float(face_cy) * src_h, pip_y + 4, pip_y + pip_h - 4))
    face_bh_px = float(facecam_roi.get("face_bh") or 0.0) * src_h
    if face_bh_px < 8:
        # Fallback: ~45 % of PiP height as face box
        face_bh_px = max(24.0, pip_h * 0.45)

    ar = OUT_W / float(STREAM_TOP_H)
    headroom = float(np.clip(FACE_HEADROOM, 0.05, 0.12))
    anchor = float(np.clip(FACE_ANCHOR_Y, 0.35, 0.55))
    # Top of headphones/hair above face center
    head_top_px = face_py - _FACE_TOP_EXTENT * face_bh_px

    def _size_for_zoom(zoom: float) -> tuple[int, int]:
        z = max(1.0, float(zoom))
        if pip_w / max(pip_h, 1) > ar:
            ch = max(32, int(round(pip_h / z)))
            cw = max(32, int(round(ch * ar)))
            if cw > pip_w:
                cw = pip_w
                ch = max(32, int(round(cw / ar)))
        else:
            cw = max(32, int(round(pip_w / z)))
            ch = max(32, int(round(cw / ar)))
            if ch > pip_h:
                ch = pip_h
                cw = max(32, int(round(ch * ar)))
        return min(cw, pip_w), min(ch, pip_h)

    zoom = max(1.0, float(FACE_TOP_ZOOM))
    cw, ch = _size_for_zoom(zoom)

    # If PiP can't fit head + headroom at this zoom, loosen zoom (larger crop)
    for _ in range(8):
        need_above = (face_py - head_top_px) + headroom * ch
        if need_above <= face_py - pip_y + 1:
            break
        zoom = max(1.0, zoom - 0.05)
        cw, ch = _size_for_zoom(zoom)

    x0 = int(np.clip(face_px - cw / 2.0, pip_x, pip_x + pip_w - cw))

    # Ideal: face at anchor. Hard: crop top ≤ head_top - headroom*ch
    y0_ideal = face_py - anchor * ch
    y0_headroom = head_top_px - headroom * ch
    y0 = min(y0_ideal, y0_headroom)
    y0 = int(np.clip(y0, pip_y, pip_y + pip_h - ch))

    # Last resort: if still tight after clamp to PiP top, nudge face lower in frame
    # by ensuring measured headroom in the crop.
    head_in_crop = head_top_px - y0
    min_pad = headroom * ch
    if head_in_crop < min_pad and y0 > pip_y:
        y0 = int(max(pip_y, head_top_px - min_pad))
        y0 = int(np.clip(y0, pip_y, pip_y + pip_h - ch))

    crop = frame[y0 : y0 + ch, x0 : x0 + cw]
    return _resize_cover(crop, OUT_W, STREAM_TOP_H)

# Stream subtitle sync (isolated from talk VAD).
# Talk VAD assumes Whisper-early and pushes text later — never used here.
# Trust speech-band correlation when confident; never push text later.
# Do NOT force a fixed lead (forced -2s over-corrected when raw≈0).
_STREAM_LAG_SEARCH_MIN = -3.0  # allow stronger pull if correlation agrees
_STREAM_LAG_SEARCH_MAX = 0.0  # never push text later on stream
_STREAM_LAG_FALLBACK = 0.0  # Whisper as-is when correlation unavailable / weak
_STREAM_LAG_HOP = 0.04
_STREAM_LAG_MARGIN_MIN = 0.035


def _stream_log(msg: str) -> None:
    """stderr so Railway shows it (stdout is truncated to ffmpeg progress)."""
    print(msg, file=sys.stderr, flush=True)


def _shift_subtitle_blocks_by(blocks: list, offset_sec: float) -> None:
    """Shift all block/word timings by offset_sec (negative = earlier on screen)."""
    if not blocks or abs(offset_sec) < 0.01:
        return
    for b in blocks:
        b["bloc_start"] = max(0.0, float(b.get("bloc_start", 0) or 0) + offset_sec)
        b["bloc_end"] = max(
            b["bloc_start"] + 0.05, float(b.get("bloc_end", 0) or 0) + offset_sec
        )
        for w in b.get("words") or []:
            w["start"] = max(0.0, float(w.get("start", 0) or 0) + offset_sec)
            w["end"] = max(w["start"] + 0.04, float(w.get("end", 0) or 0) + offset_sec)


def _speech_band_rms(video_path: str, start: float, duration: float, hop: float) -> np.ndarray | None:
    """
    RMS envelope in the speech band (300–3400 Hz) — ignores most game SFX bass/treble.
    Stream-only; does not touch talk compute_voice_activity.
    """
    sr = 16000
    cmd = [
        "ffmpeg",
        "-v",
        "error",
        "-ss",
        str(max(0.0, start)),
        "-t",
        str(max(0.05, duration)),
        "-i",
        video_path,
        "-vn",
        "-ac",
        "1",
        "-ar",
        str(sr),
        "-af",
        "highpass=f=300,lowpass=f=3400",
        "-f",
        "f32le",
        "pipe:1",
    ]
    try:
        raw = subprocess.run(cmd, capture_output=True, timeout=120).stdout
    except Exception:
        return None
    audio = np.frombuffer(raw, dtype=np.float32)
    win = max(1, int(sr * hop))
    if audio.size < win * 8:
        return None
    n = audio.size // win
    rms = np.sqrt(np.mean(audio[: n * win].reshape(n, win) ** 2, axis=1))
    # Emphasize onsets (speech attacks) over sustained game noise
    onset = np.maximum(0.0, np.diff(rms, prepend=rms[0]))
    return rms + 1.5 * onset


def _estimate_whisper_audio_offset(
    energy: np.ndarray,
    hop: float,
    blocks: list,
) -> tuple[float, float]:
    """
    Find offset o maximizing overlap(Whisper words shifted by o, speech energy).
    Returns (best_offset, score_margin). Display time = whisper_time + offset.
    """
    if energy is None or energy.size < 8 or not blocks:
        return _STREAM_LAG_FALLBACK, 0.0

    n = int(energy.size)
    word_spans: list[tuple[float, float]] = []
    for b in blocks:
        for w in b.get("words") or []:
            ws = float(w.get("start", 0) or 0)
            we = float(w.get("end", ws + 0.1) or ws + 0.1)
            if we > ws:
                word_spans.append((ws, we))
    if len(word_spans) < 3:
        return _STREAM_LAG_FALLBACK, 0.0

    # Normalize energy
    e = energy.astype(np.float64)
    e = e - float(np.median(e))
    e = np.maximum(0.0, e)
    norm = float(np.linalg.norm(e)) + 1e-9
    e = e / norm

    step = hop
    offsets = np.arange(_STREAM_LAG_SEARCH_MIN, _STREAM_LAG_SEARCH_MAX + 1e-9, step)
    scores = np.zeros(len(offsets), dtype=np.float64)

    for oi, off in enumerate(offsets):
        mask = np.zeros(n, dtype=np.float64)
        for ws, we in word_spans:
            a = int(max(0, (ws + off) / hop))
            b = int(min(n, (we + off) / hop + 1))
            if b > a:
                mask[a:b] = 1.0
        if mask.sum() < 1:
            continue
        mask = mask / (float(np.linalg.norm(mask)) + 1e-9)
        scores[oi] = float(np.dot(e, mask))

    best_i = int(np.argmax(scores))
    best = float(offsets[best_i])
    # Confidence: gap vs median score (resolve decides whether to trust)
    med = float(np.median(scores))
    margin = float(scores[best_i] - med)
    return best, margin


def _resolve_stream_whisper_offset(raw_offset: float, margin: float) -> tuple[float, str]:
    """
    Trust speech-band correlation when confident; never push text later.
    Returns (offset_sec, decision) where decision is trust|fallback|clamp_positive.
    """
    if margin < _STREAM_LAG_MARGIN_MIN:
        return _STREAM_LAG_FALLBACK, "fallback"
    if float(raw_offset) > 0.0:
        # Gaming SFX sometimes peaks at a positive lag — refuse to delay subs.
        return _STREAM_LAG_FALLBACK, "clamp_positive"
    offset = float(np.clip(float(raw_offset), _STREAM_LAG_SEARCH_MIN, _STREAM_LAG_SEARCH_MAX))
    return offset, "trust"


def _load_stream_subtitle_blocks(
    rs,
    transcription: dict,
    start: float,
    end: float,
    style: str,
    video_path: str,
) -> list:
    """
    Stream-only subtitle blocks: Whisper words + global lag vs speech-band audio.
    Never calls talk snap_blocks_to_voice / _load_blocks_for_clip.
    """
    words = rs.get_words_in_range(transcription, start, end)
    if not words:
        return []
    if style == "impact":
        blocks = rs.group_into_blocks(words, max_per_block=2, min_block_duration=0.45)
    else:
        blocks = rs.group_into_blocks(words, max_per_block=3, min_block_duration=0.35)

    duration = max(0.05, float(end) - float(start))
    energy = _speech_band_rms(video_path, start, duration, _STREAM_LAG_HOP)
    if energy is not None:
        raw_offset, margin = _estimate_whisper_audio_offset(energy, _STREAM_LAG_HOP, blocks)
        offset, decision = _resolve_stream_whisper_offset(raw_offset, margin)
        _shift_subtitle_blocks_by(blocks, offset)
        _stream_log(
            f"[STREAM] subs blocks={len(blocks)} whisper_offset={offset:+.3f}s "
            f"(raw={raw_offset:+.3f} margin={margin:.3f} decision={decision}, no talk-VAD)"
        )
    else:
        _shift_subtitle_blocks_by(blocks, _STREAM_LAG_FALLBACK)
        _stream_log(
            f"[STREAM] subs blocks={len(blocks)} whisper_offset={_STREAM_LAG_FALLBACK:+.3f}s "
            f"(raw=n/a margin=0.000 decision=fallback, no talk-VAD)"
        )
    return blocks


def compose_stream_frame(
    frame: np.ndarray,
    facecam_roi: dict[str, Any] | None,
    game_rect: tuple[int, int, int, int] | None = None,
) -> np.ndarray:
    """Compose 1080×1920: facecam top + gameplay bottom. No facecam → full center crop."""
    src_h, src_w = frame.shape[:2]
    if facecam_roi is None:
        x0, y0, cw, ch = _cover_crop_rect(src_w, src_h, OUT_W, OUT_H, 0.5, 0.45)
        return _resize_cover(frame[y0 : y0 + ch, x0 : x0 + cw], OUT_W, OUT_H)

    top = _face_anchored_top(frame, facecam_roi)

    if game_rect is None:
        game_rect = gameplay_crop_rect(src_w, src_h, facecam_roi)
    gx, gy, gw, gh = game_rect
    gx = int(np.clip(gx, 0, max(0, src_w - gw)))
    gy = int(np.clip(gy, 0, max(0, src_h - gh)))
    game_crop = frame[gy : gy + gh, gx : gx + gw]
    bottom = _resize_cover(game_crop, OUT_W, STREAM_BOTTOM_H)

    out = np.zeros((OUT_H, OUT_W, 3), dtype=np.uint8)
    out[0:STREAM_TOP_H, :] = top
    out[STREAM_TOP_H : STREAM_TOP_H + STREAM_BOTTOM_H, :] = bottom
    return out


def _sample_frames_for_detect(
    video_path: str,
    start: float,
    end: float,
    n: int = _SAMPLE_COUNT,
) -> list[np.ndarray]:
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return []
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 30.0)
    duration = max(0.1, end - start)
    frames: list[np.ndarray] = []
    for i in range(n):
        t = start + duration * (i + 0.5) / n
        cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, int(t * fps)))
        ret, frame = cap.read()
        if ret and frame is not None:
            frames.append(frame)
    cap.release()
    return frames


def _load_facecam_from_json(path: str | None) -> dict[str, Any] | None:
    if not path or not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict) and "x" in data and "y" in data and "w" in data and "h" in data:
            roi = {
                "x": float(data["x"]),
                "y": float(data["y"]),
                "w": float(data["w"]),
                "h": float(data["h"]),
                "corner": str(data.get("corner") or ""),
                "confidence": float(data.get("confidence") or 1.0),
            }
            if "face_cx" in data and "face_cy" in data:
                roi["face_cx"] = float(data["face_cx"])
                roi["face_cy"] = float(data["face_cy"])
            else:
                roi["face_cx"] = roi["x"] + roi["w"] * 0.5
                roi["face_cy"] = roi["y"] + roi["h"] * 0.4
            if "face_bw" in data and "face_bh" in data:
                roi["face_bw"] = float(data["face_bw"])
                roi["face_bh"] = float(data["face_bh"])
            else:
                roi["face_bw"] = roi["w"] * 0.45
                roi["face_bh"] = roi["h"] * 0.45
            return roi
    except (OSError, json.JSONDecodeError, TypeError, ValueError) as err:
        print(f"[STREAM] failed to load layout JSON: {err}", flush=True)
    return None


def render_stream_clip(args: Any) -> None:
    """
    Stream stack compose + subtitles.
    Encode/mux reuses talk ffmpeg helpers (read-only). Subtitle timing is
    stream-only: no talk VAD — Whisper lag estimated vs speech-band audio.
    Pixel compose (facecam/game) is stream-only.
    """
    import render_subtitles as rs

    out_w, out_h = OUT_W, OUT_H
    font_path = rs._resolve_font_path(getattr(args, "font", None))

    with open(args.transcription_path, "r", encoding="utf-8") as f:
        transcription = json.load(f)

    # Stream-only sync — never call talk _load_blocks_for_clip / snap_blocks_to_voice
    blocks = _load_stream_subtitle_blocks(
        rs,
        transcription,
        args.start,
        args.end,
        args.style,
        args.video_path,
    )

    detect_path = (
        args.proxy_path
        if (getattr(args, "proxy_path", None) and os.path.exists(args.proxy_path))
        else args.video_path
    )
    facecam = _load_facecam_from_json(getattr(args, "stream_layout", None))
    if facecam is None:
        samples = _sample_frames_for_detect(detect_path, args.start, args.end)
        facecam = detect_facecam_roi(samples)

    cap = cv2.VideoCapture(args.video_path)
    fps_src = float(cap.get(cv2.CAP_PROP_FPS) or 30.0)
    src_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1920)
    src_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 1080)

    game_rect = gameplay_crop_rect(src_w, src_h, facecam) if facecam else None

    clip_duration = max(0.05, float(args.end) - float(args.start))
    clip_frames_full = max(1, int(clip_duration * fps_src))

    # Identical stride / out_fps logic as talk mono (render_subtitles.main)
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

    # Same mux as talk — critical for subtitle/audio alignment
    ffmpeg_cmd = rs._build_ffmpeg_raw_pipe_cmd(
        out_w, out_h, out_fps, args.video_path, args.start, clip_duration, args.output_path
    )
    clean_ffmpeg_cmd = None
    if getattr(args, "clean_output", None):
        clean_ffmpeg_cmd = rs._build_ffmpeg_raw_pipe_cmd(
            out_w, out_h, out_fps, args.video_path, args.start, clip_duration, args.clean_output
        )

    print("FFMPEG_CMD:", " ".join(ffmpeg_cmd), flush=True)
    print(
        f"[STREAM] render facecam={'yes' if facecam else 'fallback-center'} "
        f"stride={stride} fps {fps_src:.3f}→{out_fps:.3f} frames={clip_frames_out}",
        flush=True,
    )

    start_pts = int(float(args.start) * fps_src)
    cap.set(cv2.CAP_PROP_POS_FRAMES, start_pts)

    t0 = time.monotonic()
    proc, stderr_chunks, stderr_thread = rs._spawn_ffmpeg_pipe(ffmpeg_cmd)

    clean_proc = None
    clean_stderr_chunks: list[bytes] = []
    clean_stderr_thread = None
    if clean_ffmpeg_cmd:
        print("FFMPEG_CLEAN_CMD:", " ".join(clean_ffmpeg_cmd), flush=True)
        try:
            clean_proc, clean_stderr_chunks, clean_stderr_thread = rs._spawn_ffmpeg_pipe(
                clean_ffmpeg_cmd
            )
        except RuntimeError as clean_err:
            print(f"[CLEAN] ffmpeg failed to start (continue without clean): {clean_err}", flush=True)
            clean_proc = None

    overlay_cache_key = None
    overlay_cache_img = None
    overlay_cache_bbox = None

    hook_text = (getattr(args, "hook_text", None) or "").strip()
    hook_duration = float(
        getattr(args, "hook_duration", rs.HOOK_DURATION_DEFAULT) or rs.HOOK_DURATION_DEFAULT
    )
    hook_overlay = None
    hook_bbox = None
    if hook_text:
        try:
            hook_overlay = rs.render_hook_title_card(out_w, out_h, hook_text, font_path)
            if hook_overlay is not None:
                hook_bbox = rs.overlay_alpha_bbox(hook_overlay)
        except Exception as hook_err:
            print(f"[HOOK] render failed (subs continue): {hook_err}", flush=True)
            hook_overlay = None
            hook_bbox = None

    rendered = 0
    for i in range(clip_frames_out):
        if stride > 1 and i > 0:
            for _ in range(stride - 1):
                cap.read()
        ret, frame = cap.read()
        if not ret:
            break

        t = i / out_fps
        composed = compose_stream_frame(frame, facecam, game_rect)

        if clean_proc is not None and clean_proc.stdin is not None:
            try:
                clean_proc.stdin.write(np.ascontiguousarray(composed).tobytes())
            except BrokenPipeError:
                print("[CLEAN] broken pipe — continue without clean base", flush=True)
                try:
                    clean_proc.stdin.close()
                except Exception:
                    pass
                clean_proc = None

        composed = rs.apply_hook_title_if_needed(
            composed, t, hook_overlay, hook_bbox, hook_duration
        )

        bloc = rs.get_bloc_at_with_silence_gate(t, blocks)
        active_word = rs.get_word_at(t, bloc) if bloc else None
        layout_mode = "normal"

        if bloc and (active_word or bloc["words"]):
            cache_key = (id(bloc), id(active_word) if active_word is not None else None, layout_mode)
            if cache_key == overlay_cache_key and overlay_cache_img is not None:
                overlay = overlay_cache_img
            else:
                overlay = rs.render_subtitle_frame(
                    out_w, out_h, bloc, active_word, args.style, font_path,
                    layout_mode=layout_mode,
                )
                overlay_cache_key = cache_key
                overlay_cache_img = overlay
                overlay_cache_bbox = rs.overlay_alpha_bbox(overlay)
            if overlay_cache_bbox is not None:
                composed = rs.blend_overlay(composed, overlay, overlay_cache_bbox)

        try:
            proc.stdin.write(np.ascontiguousarray(composed).tobytes())
        except BrokenPipeError:
            stderr_thread.join(timeout=30)
            stderr_out = b"".join(stderr_chunks).decode("utf-8", errors="replace")
            print("FFMPEG_STDERR (broken pipe):", stderr_out[-8000:], flush=True)
            raise

        rendered += 1
        if i > 0 and i % rs._PROGRESS_LOG_FRAMES == 0:
            print(f"[STREAM] frames {i}/{clip_frames_out}...", flush=True)

    proc.stdin.close()
    proc.wait()
    stderr_thread.join(timeout=120)

    if clean_proc is not None:
        try:
            if clean_proc.stdin and not clean_proc.stdin.closed:
                clean_proc.stdin.close()
        except Exception:
            pass
        clean_proc.wait()
        if clean_stderr_thread:
            clean_stderr_thread.join(timeout=120)
        if clean_proc.returncode == 0:
            print(f"[CLEAN] written → {args.clean_output}", flush=True)
        else:
            print(f"[CLEAN] ffmpeg exit {clean_proc.returncode}", flush=True)
            try:
                if args.clean_output and os.path.exists(args.clean_output):
                    os.unlink(args.clean_output)
            except OSError:
                pass

    cap.release()
    print(
        f"[TIMING] stream render {(time.monotonic() - t0):.1f}s frames={rendered}",
        flush=True,
    )
    print(
        "[LAYOUT] effective_mode=stream_stack "
        f"split_frames=0/{rendered} ratio=0.000 gated_split=0",
        flush=True,
    )

    stderr_out = b"".join(stderr_chunks).decode("utf-8", errors="replace")
    print("FFMPEG_STDERR:", stderr_out[-3000:], flush=True)
    if proc.returncode != 0:
        print("FFMPEG_EXIT_CODE:", proc.returncode, flush=True)
        sys.exit(1)
    if rendered == 0:
        print("[STREAM] no frames decoded — abort", flush=True)
        sys.exit(1)
