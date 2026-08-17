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

# Top panel: bust (tête + épaules + haut du torse), pas un tight face-crop.
# Visage dans le tiers haut → de la place pour le buste en dessous.
FACE_TOP_ZOOM = 1.0  # no extra zoom — use as much of the webcam window as possible
FACE_ANCHOR_Y = 0.34  # face high in the panel so shoulders/chest stay in frame
FACE_HEADROOM = 0.05  # little air above hair — don't pull HUD above the PiP
# Inset PiP : coupe chrome Twitch / bleed gameplay aux bords
PIP_BORDER_INSET = 0.05
# Top-edge cams sit below VOD letterbox + Twitch title — extra top crop
_PIP_TOP_EDGE_INSET = 0.10
# Au-dessus du centre visage → sommet casque/cheveux (× hauteur bbox face)
_FACE_TOP_EXTENT = 0.90
_FACE_BELOW_EXTENT = 1.75  # chin + shoulders + upper chest
_ROI_PAD_TOP = 0.03

# Facecam detection (stream-only — find ~10% PiP person on full VOD POV)
# Face area relative to full frame: small HUD noise below min, cam-zoom above max.
_FACE_MIN_AREA = 0.004
_FACE_MAX_AREA = 0.08  # above ≈ zoom cam plein écran, not a 90/10 PiP
_MIN_LOCK_HITS = 2
_SAMPLE_COUNT = 9
_GREEN_BONUS = 0.35
_CLUSTER_DIST = 0.12  # spatial cluster radius (normalized) across samples
_SOFT_LOCK_MIN = 3.0  # single-hit soft-lock needs strong PiP score + eyes
# Gaming layout: center (incl. upper-center character-select heads) = the game.
# Overlay webcams live on the edges — top-left/right included.
_CORE_MARGIN_X = 0.30
_CORE_TOP = 0.10
_CORE_BOTTOM = 0.78
# Above this in the core → 3D agent/champion, not a ~10% webcam.
_GAME_CHAR_AREA = 0.018
_GAME_CHAR_BH = 0.14
# Cam-zoom → mono. True PiP faces are ~area 0.005–0.015 / bh≲0.14.
# Zoomed cam faces are clearly larger (area≳0.028 or bh≳0.20).
_ZOOM_MIN_AREA = 0.028
_ZOOM_MIN_BH = 0.20
_ZOOM_VOTE_FRAC = 0.40
_ZOOM_VOTE_MIN = 3
_CORNER_PIP_SIDE = 0.32
_PIP_FACE_MAX_AREA = 0.016  # at or below → classic 10% PiP, never count as zoom
_MP_MODEL_PATH = str(Path(__file__).parent / "models" / "blaze_face_short_range.tflite")

_STREAM_MP_DETECTOR = None
_STREAM_MP_ERROR_LOGGED = False

EdgeLabel = str  # "tl" | "tr" | "bl" | "br" | "ml" | "mr" | "mt" | "mb" | "mid"


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


def _edge_label(cx: float, cy: float) -> EdgeLabel:
    """Derive a coarse edge label from face position (logs / gameplay nudge)."""
    left = cx < 0.35
    right = cx > 0.65
    top = cy < 0.35
    bottom = cy > 0.65
    if top and left:
        return "tl"
    if top and right:
        return "tr"
    if bottom and left:
        return "bl"
    if bottom and right:
        return "br"
    if left:
        return "ml"
    if right:
        return "mr"
    if top:
        return "mt"
    if bottom:
        return "mb"
    return "mid"


def _in_gameplay_core(cx: float, cy: float) -> bool:
    """True if face sits in the game view, not an overlay webcam.

    Includes the upper-center band: character-select heads (Valorant, splash
    art) live there. In gaming mode the center belongs to the game.
    """
    return (
        _CORE_MARGIN_X < cx < (1.0 - _CORE_MARGIN_X)
        and _CORE_TOP < cy < _CORE_BOTTOM
    )


def _roi_from_face(
    face_cx: float,
    face_cy: float,
    face_bw: float,
    face_bh: float,
) -> dict[str, Any]:
    """
    Expand a detected face into a webcam-like PiP rectangle around the person.
    Not flush to a corner — follows mid-edge / floating cams on classic 90/10 VODs.
    """
    # Typical facecam: face occupies ~40–55% of cam height — keep ROI around bust
    cam_w = float(np.clip(max(face_bw * 2.3, face_bh * 2.0), 0.14, 0.32))
    cam_h = float(np.clip(max(face_bh * 2.6, face_bw * 2.1), 0.20, 0.42))

    face_x0 = face_cx - face_bw / 2
    face_y0 = face_cy - face_bh / 2
    head_top = face_cy - _FACE_TOP_EXTENT * face_bh
    pad_top = _ROI_PAD_TOP
    pad_x = 0.02

    # Center horizontally; grow DOWN for shoulders instead of up into game HUD
    x = face_cx - cam_w / 2.0
    y = head_top - pad_top
    face_target_y = y + cam_h * 0.34
    if face_cy > face_target_y + 0.02:
        y = face_cy - cam_h * 0.34
    # Top-edge overlay: never snap the ROI to y=0 (letterbox + title + minimap)
    if y < 0.04 and face_cy < 0.38:
        y = 0.04

    y_min = 0.04 if face_cy < 0.38 else 0.0
    if face_x0 < x:
        x = face_x0 - pad_x
    if face_x0 + face_bw > x + cam_w:
        x = face_x0 + face_bw - cam_w + pad_x
    # Grow downward for shoulders; do not climb into HUD above a top-edge cam
    chest_y = face_y0 + face_bh * 1.85
    span_needed = chest_y - y
    if span_needed > cam_h:
        cam_h = float(np.clip(span_needed, cam_h, 0.44))
    if chest_y > y + cam_h:
        y = chest_y - cam_h

    x = float(np.clip(x, 0.0, max(0.0, 1.0 - cam_w)))
    y = float(np.clip(y, y_min, max(y_min, 1.0 - cam_h)))
    if y + cam_h > 1.0:
        cam_h = min(cam_h, 1.0 - y)
    if x + cam_w > 1.0:
        cam_w = min(cam_w, 1.0 - x)

    edge = _edge_label(face_cx, face_cy)
    return {
        "x": float(x),
        "y": float(y),
        "w": float(cam_w),
        "h": float(cam_h),
        "corner": edge,
        "face_cx": float(face_cx),
        "face_cy": float(face_cy),
        "face_bw": float(face_bw),
        "face_bh": float(face_bh),
    }


def _face_patch(
    frame: np.ndarray, cx: float, cy: float, bw: float, bh: float
) -> np.ndarray | None:
    if frame is None or frame.size == 0:
        return None
    h, w = frame.shape[:2]
    x0 = int(np.clip((cx - bw / 2.0) * w, 0, w - 1))
    y0 = int(np.clip((cy - bh / 2.0) * h, 0, h - 1))
    x1 = int(np.clip((cx + bw / 2.0) * w, x0 + 1, w))
    y1 = int(np.clip((cy + bh / 2.0) * h, y0 + 1, h))
    patch = frame[y0:y1, x0:x1]
    return patch if patch.size else None


def _skin_score(bgr: np.ndarray | None) -> float:
    """YCrCb skin fraction. Painted metal / plastic busts score ~0."""
    if bgr is None or bgr.size == 0 or min(bgr.shape[:2]) < 4:
        return 0.0
    ycrcb = cv2.cvtColor(bgr, cv2.COLOR_BGR2YCrCb)
    skin = cv2.inRange(ycrcb, (0, 133, 77), (255, 173, 127))
    return float(np.count_nonzero(skin)) / float(skin.size)


def _is_painted_prop(bgr: np.ndarray | None, skin: float) -> bool:
    """Helmets, busts, figurines: vivid paint, little skin (e.g. Iron Man)."""
    if skin >= 0.14:
        return False
    if bgr is None or bgr.size == 0 or min(bgr.shape[:2]) < 4:
        return False
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    hue, sat, val = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    n = float(hue.size)
    vivid_frac = float(np.count_nonzero((sat > 80) & (val > 55))) / n
    red_gold = ((hue < 22) | (hue > 168)) & (sat > 55) & (val > 45)
    rg_frac = float(np.count_nonzero(red_gold)) / n
    if skin < 0.08 and vivid_frac > 0.25:
        return True
    if skin < 0.10 and rg_frac > 0.30:
        return True
    return False


def _face_skin_and_prop(
    frame: np.ndarray, cx: float, cy: float, bw: float, bh: float
) -> tuple[float, bool]:
    patch = _face_patch(frame, cx, cy, bw, bh)
    skin = _skin_score(patch)
    return skin, _is_painted_prop(patch, skin)


def _score_pip_face(
    cx: float,
    cy: float,
    area: float,
    bw: float,
    bh: float,
    has_eyes: bool,
    green: float,
    skin: float = 0.0,
    is_prop: bool = False,
) -> float:
    """
    Score a full-frame face as a classic ~10% streamer PiP.
    Rejects cam-zoom (too large) and tiny HUD noise; penalizes bare center-game faces.
    """
    if area < _FACE_MIN_AREA or area > _FACE_MAX_AREA:
        return -1.0
    if bh > 0.22:
        # Huge head → zoomed cam or bust/prop false positive, not a 10% PiP face
        return -1.0
    in_core = _in_gameplay_core(cx, cy)
    # 3D character / cinematic face in the game view — never a webcam PiP
    if in_core and (area >= _GAME_CHAR_AREA or bh >= _GAME_CHAR_BH):
        return -1.0
    if in_core and not has_eyes:
        return -1.0
    # Flat size term — do NOT let a larger bust/prop beat a real smaller face
    size_score = 1.0 + min(1.0, area * 35.0)
    # Sweet spot for classic webcam face inside ~10–20% PiP
    if 0.005 <= area <= 0.028:
        size_score += 1.0
    elif area > 0.04:
        size_score -= (area - 0.04) * 25.0
    score = size_score
    if has_eyes:
        score += 1.5
    score += green * _GREEN_BONUS
    # Real skin beats painted busts / helmets that BlazeFace treats as faces
    score += min(1.8, max(0.0, skin) * 5.0)
    if skin < 0.05:
        score -= 1.4
    if is_prop:
        score -= 2.8
    # Human face aspect ~0.65–1.15; very tall boxes are often props / busts
    if bh > 1e-6:
        aspect = bw / bh
        if 0.55 <= aspect <= 1.25:
            score += 0.6
        elif aspect < 0.45:
            score -= 1.0
    if in_core:
        # Leftover small HUD / splash faces in the game view
        score -= 1.8
    else:
        # All four corners are valid overlay cams (top-left included)
        edge_dist = min(cx, 1.0 - cx, cy, 1.0 - cy)
        if edge_dist < 0.22:
            score += 0.8
        elif edge_dist < 0.35:
            score += 0.25
        if min(cx, 1.0 - cx) < 0.38 and 0.22 < cy < 0.78:
            score += 0.25
    return float(score)


def _select_best_pip_face(
    faces: list[tuple[float, float, float, float, float, bool]],
    scores: list[float],
    skins: list[float] | None = None,
    props: list[bool] | None = None,
) -> int | None:
    """
    Pick streamer face among candidates.

    Same PiP often yields a false hit on shelf props (bust, helmet) next to or
    above the real person — prefer skin, then the lower eyed face.
    """
    valid = [i for i, s in enumerate(scores) if s >= 0]
    if not valid:
        return None
    skins = skins if skins is not None else [0.0] * len(faces)
    props = props if props is not None else [False] * len(faces)
    # Overlay cam always beats a leftover game-view face on the same frame
    edge_valid = [
        i for i in valid if not _in_gameplay_core(faces[i][0], faces[i][1])
    ]
    if edge_valid:
        valid = edge_valid
    adjusted = list(scores)
    for i in valid:
        cx_i, cy_i, _, _, _, eyes_i = faces[i]
        if props[i]:
            adjusted[i] -= 2.0
        for j in valid:
            if i == j:
                continue
            cx_j, cy_j, _, _, _, eyes_j = faces[j]
            dist2 = (cx_j - cx_i) ** 2 + (cy_j - cy_i) ** 2
            nearby = dist2 < 0.28**2
            # j is below i, similar x → i is likely decor above the streamer
            if (
                eyes_j
                and cy_j > cy_i + 0.05
                and abs(cx_j - cx_i) < 0.20
                and dist2 < 0.28**2
            ):
                adjusted[i] -= 2.5
            # Extra: if i has no eyes and j does nearby, dump i
            if not eyes_i and eyes_j and abs(cx_j - cx_i) < 0.22 and abs(cy_j - cy_i) < 0.25:
                adjusted[i] -= 1.5
            # Same webcam: painted bust/helmet beside the person (not only above)
            if nearby and skins[j] >= 0.10 and skins[i] < skins[j] - 0.07:
                adjusted[i] -= 3.2
            if nearby and props[i] and not props[j]:
                adjusted[i] -= 3.5
    best_i = max(valid, key=lambda i: adjusted[i])
    if adjusted[best_i] < 0:
        return None
    return best_i


def _cluster_hits(
    hits: list[tuple[float, dict[str, Any]]],
) -> list[list[tuple[float, dict[str, Any]]]]:
    """Greedy spatial clusters by face center across sample hits."""
    clusters: list[list[tuple[float, dict[str, Any]]]] = []
    for score, roi in sorted(hits, key=lambda t: t[0], reverse=True):
        fcx = float(roi["face_cx"])
        fcy = float(roi["face_cy"])
        placed = False
        for cluster in clusters:
            rcx = float(np.median([r["face_cx"] for _, r in cluster]))
            rcy = float(np.median([r["face_cy"] for _, r in cluster]))
            if (fcx - rcx) ** 2 + (fcy - rcy) ** 2 <= _CLUSTER_DIST**2:
                cluster.append((score, roi))
                placed = True
                break
        if not placed:
            clusters.append([(score, roi)])
    return clusters


def _median_roi(
    items: list[tuple[float, dict[str, Any]]],
    edge: EdgeLabel,
    conf_scale: float = 1.0,
) -> dict[str, Any]:
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
        "corner": edge,
        "confidence": float(np.mean(confs) * conf_scale),
    }


def _scan_windows(w: int, h: int) -> list[tuple[int, int, int, int]]:
    """
    Full frame + overlapping tiles covering the whole VOD.

    BlazeFace short-range misses tiny PiPs on a raw 1080p frame; tiles magnify
    local content while still searching mid-edge / floating cams (not corners only).
    """
    windows: list[tuple[int, int, int, int]] = [(0, 0, w, h)]
    ox = max(24, int(w * 0.08))
    oy = max(24, int(h * 0.08))
    tw = min(w, w // 2 + ox)
    th = min(h, h // 2 + oy)
    for y0 in (0, max(0, h - th)):
        for x0 in (0, max(0, w - tw)):
            x1 = min(w, x0 + tw)
            y1 = min(h, y0 + th)
            if (x0, y0, x1, y1) != (0, 0, w, h):
                windows.append((x0, y0, x1, y1))
    # Extra vertical mid-band strips (classic floating left/right cams)
    mid_y0 = max(0, int(h * 0.15))
    mid_y1 = min(h, int(h * 0.85))
    sw = min(w, int(w * 0.42))
    if mid_y1 > mid_y0 + 64 and sw >= 96:
        windows.append((0, mid_y0, sw, mid_y1))
        windows.append((max(0, w - sw), mid_y0, w, mid_y1))
    # Tight corners so a ~10% top-left PiP fills more of BlazeFace's crop
    cw = min(w, int(w * 0.30))
    ch = min(h, int(h * 0.36))
    if cw >= 96 and ch >= 96:
        for y0 in (0, max(0, h - ch)):
            for x0 in (0, max(0, w - cw)):
                windows.append((x0, y0, min(w, x0 + cw), min(h, y0 + ch)))
    return windows


def _faces_on_frame(frame: np.ndarray) -> list[tuple[float, float, float, float, float, bool]]:
    """Detect faces anywhere on the frame; coords normalized to full frame."""
    if frame is None or frame.size == 0:
        return []
    h, w = frame.shape[:2]
    found: list[tuple[float, float, float, float, float, bool]] = []
    for x0, y0, x1, y1 in _scan_windows(w, h):
        crop = np.ascontiguousarray(frame[y0:y1, x0:x1])
        if crop.size == 0:
            continue
        local = _detect_faces_in_bgr(crop)
        if not local:
            continue
        span_x = (x1 - x0) / w
        span_y = (y1 - y0) / h
        for lcx, lcy, larea, lbw, lbh, has_eyes in local:
            cx = x0 / w + lcx * span_x
            cy = y0 / h + lcy * span_y
            area = larea * span_x * span_y
            bw = lbw * span_x
            bh = lbh * span_y
            # Dedupe near-duplicates from overlapping tiles
            dup = False
            for i, (ecx, ecy, earea, ebw, ebh, eeyes) in enumerate(found):
                if (cx - ecx) ** 2 + (cy - ecy) ** 2 < 0.012**2:
                    # Keep larger / eyed detection
                    if (has_eyes, area) > (eeyes, earea):
                        found[i] = (cx, cy, area, bw, bh, has_eyes)
                    dup = True
                    break
            if not dup:
                found.append((cx, cy, area, bw, bh, has_eyes))
    return found


def detect_facecam_roi(
    frames: list[np.ndarray],
) -> dict[str, Any] | None:
    """
    Find the streamer in the classic VOD PiP (~10% person + ~90% gameplay).

    Search the whole frame (full + tiles); lock the spatially stable PiP-sized face.
    Returns {x,y,w,h,corner,face_*,confidence} in normalized coords, or None.
    """
    if not frames:
        return None

    hits: list[tuple[float, dict[str, Any]]] = []
    for frame in frames:
        if frame is None or frame.size == 0:
            continue
        h, w = frame.shape[:2]
        faces = _faces_on_frame(frame)
        if not faces:
            continue
        scores: list[float] = []
        skins: list[float] = []
        props: list[bool] = []
        for cx, cy, area, bw, bh, has_eyes in faces:
            fx0 = int(np.clip((cx - bw) * w, 0, w - 1))
            fy0 = int(np.clip((cy - bh) * h, 0, h - 1))
            fx1 = int(np.clip((cx + bw) * w, fx0 + 1, w))
            fy1 = int(np.clip((cy + bh) * h, fy0 + 1, h))
            patch = frame[fy0:fy1, fx0:fx1]
            green = _green_screen_score(patch) if patch.size else 0.0
            skin, is_prop = _face_skin_and_prop(frame, cx, cy, bw, bh)
            skins.append(skin)
            props.append(is_prop)
            scores.append(
                _score_pip_face(cx, cy, area, bw, bh, has_eyes, green, skin, is_prop)
            )
        best_i = _select_best_pip_face(faces, scores, skins, props)
        if best_i is None:
            continue
        cx, cy, area, bw, bh, has_eyes = faces[best_i]
        score = scores[best_i]
        roi = _roi_from_face(cx, cy, bw, bh)
        roi["confidence"] = score
        roi["_has_eyes"] = bool(has_eyes)
        hits.append((score, roi))

    if not hits:
        print("[STREAM] facecam not found", flush=True)
        return None

    clusters = _cluster_hits(hits)
    # Edge/corner PiP beats a centered character-select head even if the 3D
    # face is detected on more samples (stable, well-lit, looking at camera).
    def _cluster_key(c: list[tuple[float, dict[str, Any]]]) -> tuple:
        cx = float(np.median([r["face_cx"] for _, r in c]))
        cy = float(np.median([r["face_cy"] for _, r in c]))
        edge = 0 if _in_gameplay_core(cx, cy) else 1
        mean = sum(s for s, _ in c) / max(1, len(c))
        return (edge, len(c), mean)

    clusters.sort(key=_cluster_key, reverse=True)
    best = clusters[0]
    edge = _edge_label(
        float(np.median([r["face_cx"] for _, r in best])),
        float(np.median([r["face_cy"] for _, r in best])),
    )

    if len(best) < _MIN_LOCK_HITS:
        # Soft-lock: one strong overlay hit. Corner PiPs often look down/away
        # (Valorant top-left) — eyes not required there. Game-view faces still are.
        soft = max(hits, key=lambda t: t[0])
        soft_roi = soft[1]
        has_eyes = bool(soft_roi.get("_has_eyes", False))
        scx = float(soft_roi["face_cx"])
        scy = float(soft_roi["face_cy"])
        edge_dist = min(scx, 1.0 - scx, scy, 1.0 - scy)
        for _, r in hits:
            r.pop("_has_eyes", None)
        if (
            soft[0] >= _SOFT_LOCK_MIN
            and not _in_gameplay_core(scx, scy)
            and (has_eyes or edge_dist < 0.22)
        ):
            roi = _median_roi(
                [soft], str(soft_roi.get("corner") or edge), conf_scale=0.6
            )
            print(
                f"[STREAM] facecam soft-lock corner={roi['corner']} "
                f"face=({roi['face_cx']:.2f},{roi['face_cy']:.2f}) "
                f"conf={roi['confidence']:.2f} hits=1",
                flush=True,
            )
            return roi
        print("[STREAM] facecam not found", flush=True)
        return None

    for _, r in hits:
        r.pop("_has_eyes", None)
    roi = _median_roi(best, edge)
    print(
        f"[STREAM] facecam lock corner={edge} "
        f"roi=({roi['x']:.2f},{roi['y']:.2f},{roi['w']:.2f},{roi['h']:.2f}) "
        f"face=({roi['face_cx']:.2f},{roi['face_cy']:.2f}) "
        f"hits={len(best)} conf={roi['confidence']:.2f}",
        flush=True,
    )
    return roi


def _face_confined_to_corner_pip(
    cx: float, cy: float, bw: float, bh: float
) -> bool:
    """True if the face bbox sits mostly inside a classic corner PiP square."""
    side = _CORNER_PIP_SIDE
    x0, y0 = cx - bw / 2.0, cy - bh / 2.0
    x1, y1 = cx + bw / 2.0, cy + bh / 2.0
    for cx0, cy0 in (
        (0.0, 0.0),
        (1.0 - side, 0.0),
        (0.0, 1.0 - side),
        (1.0 - side, 1.0 - side),
    ):
        if (
            x0 >= cx0 - 0.02
            and y0 >= cy0 - 0.02
            and x1 <= cx0 + side + 0.02
            and y1 <= cy0 + side + 0.02
        ):
            return True
    return False


def _pip_scores_for_faces(
    frame: np.ndarray,
    faces: list[tuple[float, float, float, float, float, bool]],
) -> tuple[list[float], list[float], list[bool]]:
    h, w = frame.shape[:2]
    scores: list[float] = []
    skins: list[float] = []
    props: list[bool] = []
    for cx, cy, area, bw, bh, has_eyes in faces:
        fx0 = int(np.clip((cx - bw) * w, 0, w - 1))
        fy0 = int(np.clip((cy - bh) * h, 0, h - 1))
        fx1 = int(np.clip((cx + bw) * w, fx0 + 1, w))
        fy1 = int(np.clip((cy + bh) * h, fy0 + 1, h))
        patch = frame[fy0:fy1, fx0:fx1]
        green = _green_screen_score(patch) if patch.size else 0.0
        skin, is_prop = _face_skin_and_prop(frame, cx, cy, bw, bh)
        skins.append(skin)
        props.append(is_prop)
        scores.append(
            _score_pip_face(cx, cy, area, bw, bh, has_eyes, green, skin, is_prop)
        )
    return scores, skins, props


def _frame_is_cam_zoom(
    frame: np.ndarray,
) -> tuple[bool, dict[str, Any] | None]:
    """
    Large eyed face filling the frame → cam zoom (mono).

    Classic ~10% PiP (small face, especially corner) never counts as zoom.
    """
    if frame is None or frame.size == 0:
        return False, None
    faces = _faces_on_frame(frame)
    if not faces:
        return False, None
    scores, skins, props = _pip_scores_for_faces(frame, faces)
    pip_i = _select_best_pip_face(faces, scores, skins, props)
    if pip_i is not None:
        pcx, pcy, p_area, pbw, p_bh, _eyes = faces[pip_i]
        # Real 90/10 PiP face → not zoom
        if p_area <= _PIP_FACE_MAX_AREA:
            return False, None
        if (
            p_area < _ZOOM_MIN_AREA
            and p_bh < _ZOOM_MIN_BH
            and _face_confined_to_corner_pip(pcx, pcy, pbw, p_bh)
        ):
            return False, None

    best: tuple[float, float, float, float, float, bool] | None = None
    best_key = (-1.0, -1.0)
    for cx, cy, area, bw, bh, has_eyes in faces:
        if not has_eyes:
            continue
        # Never treat classic small PiP faces as zoom (mid-left cams included)
        if area <= _PIP_FACE_MAX_AREA:
            continue
        # Character-select / in-world 3D head ≠ streamer cam-zoom
        if (
            _in_gameplay_core(cx, cy)
            and not _face_confined_to_corner_pip(cx, cy, bw, bh)
            and area < 0.10
            and bh < 0.32
        ):
            continue
        large = area >= _ZOOM_MIN_AREA or bh >= _ZOOM_MIN_BH
        if not large:
            continue
        if _face_confined_to_corner_pip(cx, cy, bw, bh) and area < _ZOOM_MIN_AREA:
            continue
        key = (area, bh)
        if key > best_key:
            best_key = key
            best = (cx, cy, area, bw, bh, has_eyes)
    if best is None:
        return False, None
    cx, cy, area, bw, bh, _ = best
    return True, {
        "face_cx": float(cx),
        "face_cy": float(cy),
        "face_bw": float(bw),
        "face_bh": float(bh),
        "area": float(area),
    }


def classify_stream_layout(
    frames: list[np.ndarray],
) -> tuple[str, dict[str, Any] | None, dict[str, Any] | None]:
    """
    Per-clip layout: "mono" only when a clear majority of samples are cam-zoom.
    Otherwise "stack" with detect_facecam_roi (may be None → center fallback).

    Returns (layout, facecam_roi|None, mono_face|None).
    """
    zoom_faces: list[dict[str, Any]] = []
    n_valid = 0
    for frame in frames:
        if frame is None or frame.size == 0:
            continue
        n_valid += 1
        is_zoom, face = _frame_is_cam_zoom(frame)
        if is_zoom and face is not None:
            zoom_faces.append(face)

    need = max(_ZOOM_VOTE_MIN, int(np.ceil(_ZOOM_VOTE_FRAC * max(n_valid, 1))))
    # For 9 samples → need 4 (40%). Tighter cases use zoom_plurality below.
    if len(zoom_faces) >= need:
        mono_face = {
            "face_cx": float(np.median([f["face_cx"] for f in zoom_faces])),
            "face_cy": float(np.median([f["face_cy"] for f in zoom_faces])),
            "face_bw": float(np.median([f["face_bw"] for f in zoom_faces])),
            "face_bh": float(np.median([f["face_bh"] for f in zoom_faces])),
            "area": float(np.median([f.get("area", 0.0) for f in zoom_faces])),
        }
        print(
            f"[STREAM] layout=mono zoom_hits={len(zoom_faces)}/{n_valid} "
            f"need>={need} face=({mono_face['face_cx']:.2f},{mono_face['face_cy']:.2f}) "
            f"area={mono_face['area']:.3f}",
            flush=True,
        )
        return "mono", None, mono_face

    facecam = detect_facecam_roi(frames)
    # Safety: if we locked a "PiP" whose face is actually zoom-sized → promote mono
    if facecam is not None:
        fbh = float(facecam.get("face_bh") or 0.0)
        fbw = float(facecam.get("face_bw") or 0.0)
        fcx = float(facecam.get("face_cx") or 0.5)
        fcy = float(facecam.get("face_cy") or 0.45)
        farea = fbw * fbh
        if (farea >= _ZOOM_MIN_AREA or fbh >= _ZOOM_MIN_BH) and not _face_confined_to_corner_pip(
            fcx, fcy, fbw, fbh
        ):
            mono_face = {
                "face_cx": fcx,
                "face_cy": fcy,
                "face_bw": fbw,
                "face_bh": fbh,
                "area": farea,
            }
            print(
                f"[STREAM] layout=mono promote_from_stack "
                f"face=({fcx:.2f},{fcy:.2f}) area={farea:.3f} bh={fbh:.3f}",
                flush=True,
            )
            return "mono", None, mono_face

    # Zoom plurality + high/weak PiP lock (wall/decor) → mono
    if (
        zoom_faces
        and len(zoom_faces) >= _ZOOM_VOTE_MIN
        and facecam is not None
        and (
            float(facecam.get("face_cy") or 0.5) < 0.28
            or float(facecam.get("confidence") or 0) < 4.5
            or len(zoom_faces) >= (n_valid - len(zoom_faces))
        )
    ):
        mono_face = {
            "face_cx": float(np.median([f["face_cx"] for f in zoom_faces])),
            "face_cy": float(np.median([f["face_cy"] for f in zoom_faces])),
            "face_bw": float(np.median([f["face_bw"] for f in zoom_faces])),
            "face_bh": float(np.median([f["face_bh"] for f in zoom_faces])),
            "area": float(np.median([f.get("area", 0.0) for f in zoom_faces])),
        }
        print(
            f"[STREAM] layout=mono zoom_plurality zoom_hits={len(zoom_faces)}/{n_valid} "
            f"face=({mono_face['face_cx']:.2f},{mono_face['face_cy']:.2f}) "
            f"pip_cy={float(facecam.get('face_cy') or 0):.2f}",
            flush=True,
        )
        return "mono", None, mono_face

    # Weak PiP lock + several zoom hits → prefer mono (avoid wall/decor stack)
    if (
        zoom_faces
        and len(zoom_faces) >= _ZOOM_VOTE_MIN
        and (facecam is None or float(facecam.get("confidence") or 0) < 4.0)
    ):
        mono_face = {
            "face_cx": float(np.median([f["face_cx"] for f in zoom_faces])),
            "face_cy": float(np.median([f["face_cy"] for f in zoom_faces])),
            "face_bw": float(np.median([f["face_bw"] for f in zoom_faces])),
            "face_bh": float(np.median([f["face_bh"] for f in zoom_faces])),
            "area": float(np.median([f.get("area", 0.0) for f in zoom_faces])),
        }
        print(
            f"[STREAM] layout=mono weak_pip_fallback zoom_hits={len(zoom_faces)}/{n_valid} "
            f"face=({mono_face['face_cx']:.2f},{mono_face['face_cy']:.2f})",
            flush=True,
        )
        return "mono", None, mono_face

    if facecam is not None:
        # Re-anchor face inside the PiP so top panel doesn't lock on wall/decor
        facecam = _refine_facecam_face(frames, facecam)

    print(
        f"[STREAM] layout=stack zoom_hits={len(zoom_faces)}/{n_valid} "
        f"need>={need} facecam={'yes' if facecam else 'no'}",
        flush=True,
    )
    return "stack", facecam, None


def _refine_facecam_face(
    frames: list[np.ndarray],
    facecam: dict[str, Any],
) -> dict[str, Any]:
    """
    Re-detect the streamer face inside the locked PiP ROI.

    Avoids top-panel crops locked on shelf props (bust, helmet) beside or above
    the person when BlazeFace treats painted metal as a face.
    """
    refined: list[tuple[float, float, float, float]] = []
    for frame in frames:
        if frame is None or frame.size == 0:
            continue
        h, w = frame.shape[:2]
        # Search around the locked ROI — false locks sit on wall ABOVE or a
        # bust BESIDE the streamer, so expand left/right not only down.
        pad_x = int(0.10 * w)
        x0 = int(np.clip(float(facecam["x"]) * w - pad_x, 0, w - 1))
        y0 = int(np.clip(float(facecam["y"]) * h, 0, h - 1))
        x1 = int(
            np.clip((float(facecam["x"]) + float(facecam["w"])) * w + pad_x, x0 + 1, w)
        )
        y1 = int(
            np.clip(
                (float(facecam["y"]) + float(facecam["h"]) * 1.55) * h,
                y0 + 1,
                h,
            )
        )
        crop = np.ascontiguousarray(frame[y0:y1, x0:x1])
        if crop.size == 0:
            continue
        faces = _detect_faces_in_bgr(crop)
        if not faces:
            continue
        best = None
        best_key: tuple | None = None
        for lcx, lcy, larea, lbw, lbh, has_eyes in faces:
            patch = _face_patch(crop, lcx, lcy, lbw, lbh)
            skin = _skin_score(patch)
            prop = _is_painted_prop(patch, skin)
            # Skin first (dump Iron Man / figurines), then eyes, then lower in frame
            key = (0 if prop else 1, skin, 1 if has_eyes else 0, lcy, larea)
            if best_key is None or key > best_key:
                best_key = key
                best = (lcx, lcy, larea, lbw, lbh, skin, prop)
        if best is None:
            continue
        lcx, lcy, _a, lbw, lbh, _skin, _prop = best
        span_x = (x1 - x0) / w
        span_y = (y1 - y0) / h
        refined.append(
            (
                x0 / w + lcx * span_x,
                y0 / h + lcy * span_y,
                lbw * span_x,
                lbh * span_y,
            )
        )
    if len(refined) < 1:
        return facecam
    out = dict(facecam)
    out["face_cx"] = float(np.median([r[0] for r in refined]))
    out["face_cy"] = float(np.median([r[1] for r in refined]))
    out["face_bw"] = float(np.median([r[2] for r in refined]))
    out["face_bh"] = float(np.median([r[3] for r in refined]))
    # Rebuild PiP around the refined face when it drifted (bust beside/above)
    dx = abs(out["face_cx"] - float(facecam.get("face_cx") or out["face_cx"]))
    dy = abs(out["face_cy"] - float(facecam.get("face_cy") or out["face_cy"]))
    if dx > 0.025 or dy > 0.04:
        rebuilt = _roi_from_face(
            out["face_cx"], out["face_cy"], out["face_bw"], out["face_bh"]
        )
        rebuilt["confidence"] = float(facecam.get("confidence") or 1.0)
        out = rebuilt
    print(
        f"[STREAM] facecam refine face=({out['face_cx']:.2f},{out['face_cy']:.2f}) "
        f"from=({facecam.get('face_cx', 0):.2f},{facecam.get('face_cy', 0):.2f}) "
        f"hits={len(refined)}",
        flush=True,
    )
    return out


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
    Cover-crop for gameplay, locked on the 16:9 center (crosshair / buy phase).

    A centered crop already clips most of a corner PiP; do not pan away from
    the game center or HUD landmarks slide to the edge.
    """
    del facecam_roi  # overlay cam is in the top panel; game stays centered
    return _cover_crop_rect(frame_w, frame_h, panel_w, panel_h, 0.5, 0.5)


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
    """PiP rectangle in pixels, inset to drop Twitch chrome / HUD above the cam."""
    x = float(facecam_roi["x"])
    y = float(facecam_roi["y"])
    w = float(facecam_roi["w"])
    h = float(facecam_roi["h"])
    inset = float(np.clip(inset, 0.0, 0.2))
    corner = str(facecam_roi.get("corner") or "")
    inset_top = inset
    if corner in ("tl", "tr", "mt"):
        inset_top = min(0.22, inset + _PIP_TOP_EDGE_INSET)
    x += w * inset
    y += h * inset_top
    w *= 1.0 - 2.0 * inset
    h *= 1.0 - inset_top - inset
    fx = int(np.clip(round(x * src_w), 0, max(0, src_w - 2)))
    fy = int(np.clip(round(y * src_h), 0, max(0, src_h - 2)))
    fw = max(16, int(round(w * src_w)))
    fh = max(16, int(round(h * src_h)))
    fw = min(fw, src_w - fx)
    fh = min(fh, src_h - fy)
    return fx, fy, fw, fh


def _pip_fallback_top(
    frame: np.ndarray,
    facecam_roi: dict[str, Any],
    panel_w: int = OUT_W,
    panel_h: int = STREAM_TOP_H,
) -> np.ndarray:
    src_h, src_w = frame.shape[:2]
    fx, fy, fw, fh = _pip_pixel_box(facecam_roi, src_w, src_h)
    return _resize_cover(frame[fy : fy + fh, fx : fx + fw], panel_w, panel_h)


def _face_anchored_top(
    frame: np.ndarray,
    facecam_roi: dict[str, Any],
    panel_w: int = OUT_W,
    panel_h: int = STREAM_TOP_H,
) -> np.ndarray:
    """
    Bust framing (head + shoulders) for top panel.

    Hard rules (stream-only):
    - Crop stays inside inset PiP (no Twitch chrome / game bleed).
    - Head never clipped: ≥ FACE_HEADROOM free above hair/headphones.
    - Chin/shoulders kept via _FACE_BELOW_EXTENT.
    - Face near FACE_ANCHOR_Y.
    """
    src_h, src_w = frame.shape[:2]
    pip_x, pip_y, pip_w, pip_h = _pip_pixel_box(facecam_roi, src_w, src_h)
    if pip_w < 16 or pip_h < 16:
        return _pip_fallback_top(frame, facecam_roi, panel_w, panel_h)

    face_cx = facecam_roi.get("face_cx")
    face_cy = facecam_roi.get("face_cy")
    if face_cx is None or face_cy is None:
        return _resize_cover(
            frame[pip_y : pip_y + pip_h, pip_x : pip_x + pip_w], panel_w, panel_h
        )

    face_px = float(np.clip(float(face_cx) * src_w, pip_x + 4, pip_x + pip_w - 4))
    face_py = float(np.clip(float(face_cy) * src_h, pip_y + 4, pip_y + pip_h - 4))
    face_bh_px = float(facecam_roi.get("face_bh") or 0.0) * src_h
    if face_bh_px < 8:
        face_bh_px = max(24.0, pip_h * 0.45)

    ar = panel_w / float(panel_h)
    headroom = float(np.clip(FACE_HEADROOM, 0.03, 0.10))
    anchor = float(np.clip(FACE_ANCHOR_Y, 0.30, 0.50))
    head_top_px = face_py - _FACE_TOP_EXTENT * face_bh_px
    chin_px = face_py + _FACE_BELOW_EXTENT * face_bh_px

    # Minimum crop height to fit headroom + face + chin/shoulders
    need_h = int(
        np.ceil(
            (face_py - head_top_px)
            + headroom * face_bh_px
            + (chin_px - face_py)
            + 4
        )
    )
    need_h = max(need_h, int(face_bh_px * 3.4))

    def _size_for_zoom(zoom: float) -> tuple[int, int]:
        z = max(1.0, float(zoom))
        # Use as much PiP height as needed for bust; width follows panel AR
        ch = min(pip_h, max(need_h, int(round(pip_h / z))))
        cw = max(32, int(round(ch * ar)))
        if cw > pip_w:
            cw = pip_w
            ch = max(32, min(pip_h, int(round(cw / ar))))
        return min(cw, pip_w), min(ch, pip_h)

    zoom = max(1.0, float(FACE_TOP_ZOOM))
    cw, ch = _size_for_zoom(zoom)

    # Loosen until head + chin fit inside PiP vertically
    for _ in range(10):
        above_ok = (face_py - head_top_px) + headroom * ch <= face_py - pip_y + 1
        below_ok = chin_px <= pip_y + pip_h - 1
        fit_ok = ch >= min(need_h, pip_h)
        if above_ok and fit_ok:
            break
        zoom = max(1.0, zoom - 0.08)
        cw, ch = _size_for_zoom(zoom)

    # PiP too small for a clean bust crop → show whole cam window
    if ch < min(need_h, int(pip_h * 0.85)) or chin_px - head_top_px > pip_h * 0.98:
        return _pip_fallback_top(frame, facecam_roi, panel_w, panel_h)

    x0 = int(np.clip(face_px - cw / 2.0, pip_x, pip_x + pip_w - cw))

    y0_ideal = face_py - anchor * ch
    y0_chin = chin_px - ch + 2  # keep shoulders/chest inside bottom
    # Prefer bust over empty wall/HUD: sit the crop lower in the PiP
    y0 = max(y0_ideal, y0_chin)
    y0 = int(np.clip(y0, pip_y, pip_y + pip_h - ch))

    # If chest still clipped after clamp, fall back to full PiP
    if y0 + ch < chin_px - 2 and pip_h >= ch:
        return _pip_fallback_top(frame, facecam_roi, panel_w, panel_h)

    crop = frame[y0 : y0 + ch, x0 : x0 + cw]
    return _resize_cover(crop, panel_w, panel_h)

# Stream subtitle sync (isolated from talk VAD).
# Talk VAD assumes Whisper-early and pushes text later — never used here.
# Trust speech-band correlation for micro-adjust only; never push text later.
# Do NOT force a fixed lead (forced -2s over-corrected when raw≈0).
# Real A/V skew is fixed at Twitch download (segment-sync) — not here.
_STREAM_LAG_SEARCH_MIN = -0.5  # micro-adjust only once file A/V is aligned
_STREAM_LAG_SEARCH_MAX = 0.0  # never push text later on stream
_STREAM_LAG_FALLBACK = 0.0  # Whisper as-is when correlation unavailable / weak
_STREAM_LAG_HOP = 0.04
_STREAM_LAG_MARGIN_MIN = 0.035
# Gaming: Whisper often stretches the last word over game silence (3–4s).
_STREAM_WORD_MAX_SEC = 1.0
_STREAM_BLOCK_MAX_SEC = 1.5  # 2-word impact block, still snappy
_STREAM_BLOCK_GRACE_SEC = 0.10
_STREAM_SILENCE_GATE_SEC = 0.12


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


def _cap_stream_subtitle_durations(blocks: list) -> None:
    """Max 1s per word; block dies with the last word (plus a tiny grace)."""
    for b in blocks:
        words = b.get("words") or []
        s = float(b.get("bloc_start", 0) or 0)
        for w in words:
            ws = float(w.get("start", s) or s)
            we = float(w.get("end", ws) or ws)
            w["start"] = ws
            w["end"] = min(max(we, ws + 0.06), ws + _STREAM_WORD_MAX_SEC)
        if words:
            last_end = max(float(w["end"]) for w in words)
        else:
            last_end = s
        new_end = min(
            float(b.get("bloc_end", last_end) or last_end),
            last_end + _STREAM_BLOCK_GRACE_SEC,
            s + _STREAM_BLOCK_MAX_SEC,
        )
        new_end = max(new_end, s + 0.08)
        b["bloc_end"] = new_end
        for w in words:
            w["end"] = min(float(w["end"]), new_end)
            w["start"] = min(float(w["start"]), max(s, new_end - 0.04))


def _trim_stream_blocks_to_speech(
    blocks: list,
    energy: np.ndarray | None,
    hop: float,
) -> None:
    """Cut display as soon as speech-band energy dies (game SFX ignored)."""
    if energy is None or energy.size < 8 or not blocks:
        return
    e = np.maximum(0.0, energy.astype(np.float64))
    p35 = float(np.percentile(e, 35))
    p90 = float(np.percentile(e, 90))
    thr = p35 + 0.35 * max(0.0, p90 - p35)
    thr = max(thr, 1e-6)
    for b in blocks:
        s = float(b.get("bloc_start", 0) or 0)
        end = float(b.get("bloc_end", s) or s)
        i0 = int(max(0, s / hop))
        i1 = int(min(e.size, end / hop + 1))
        if i1 <= i0:
            continue
        voiced = np.where(e[i0:i1] > thr)[0]
        if voiced.size == 0:
            new_end = min(end, s + 0.22)
        else:
            last_t = (i0 + int(voiced[-1]) + 1) * hop
            new_end = min(end, last_t + _STREAM_BLOCK_GRACE_SEC)
        new_end = max(new_end, s + 0.08)
        b["bloc_end"] = new_end
        for w in b.get("words") or []:
            w["end"] = min(float(w.get("end", new_end) or new_end), new_end)


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
    # Tiny positive from float noise / SFX — never delay subs.
    if float(raw_offset) > 0.01:
        return _STREAM_LAG_FALLBACK, "clamp_positive"
    offset = float(np.clip(float(raw_offset), _STREAM_LAG_SEARCH_MIN, _STREAM_LAG_SEARCH_MAX))
    return offset, "trust"


def _probe_video_meta(video_path: str) -> tuple[float, int, int]:
    """fps, width, height via ffprobe (no OpenCV seek)."""
    try:
        raw = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height,avg_frame_rate,r_frame_rate",
                "-of",
                "json",
                video_path,
            ],
            capture_output=True,
            timeout=30,
            check=False,
        ).stdout
        stream = (json.loads(raw.decode("utf-8", errors="replace") or "{}").get("streams") or [{}])[0]
        w = int(stream.get("width") or 1920)
        h = int(stream.get("height") or 1080)
        rate = str(stream.get("avg_frame_rate") or stream.get("r_frame_rate") or "30/1")
        num_s, _, den_s = rate.partition("/")
        num, den = float(num_s or 0), float(den_s or 1)
        fps = (num / den) if num > 0 and den > 0 else 30.0
        return float(fps), w, h
    except Exception:
        return 30.0, 1920, 1080


def _spawn_ffmpeg_bgr_reader(
    video_path: str,
    start: float,
    duration: float,
    out_fps: float,
    width: int,
    height: int,
) -> subprocess.Popen:
    """
    Decode frames with the same -ss/-t clock as audio mux (-ss AFTER -i).
    Avoids OpenCV CAP_PROP_POS_FRAMES (keyframe-imprecise on Twitch/Railway).
    """
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        video_path,
        "-ss",
        f"{max(0.0, float(start)):.3f}",
        "-t",
        f"{max(0.05, float(duration)):.3f}",
        "-vf",
        f"fps={out_fps:.6f}".rstrip("0").rstrip("."),
        "-an",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "bgr24",
        "pipe:1",
    ]
    _stream_log(f"[STREAM] decode ffmpeg {' '.join(cmd)}")
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    return proc


def _read_bgr_frame(proc: subprocess.Popen, width: int, height: int) -> np.ndarray | None:
    if proc.stdout is None:
        return None
    need = int(width) * int(height) * 3
    buf = proc.stdout.read(need)
    if not buf or len(buf) < need:
        return None
    return np.frombuffer(buf, dtype=np.uint8).reshape((height, width, 3)).copy()


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
        blocks = rs.group_into_blocks(words, max_per_block=2, min_block_duration=0.25)
    elif style == "minimal":
        blocks = rs.group_into_blocks(words, max_per_block=6, min_block_duration=0.35)
    else:
        blocks = rs.group_into_blocks(words, max_per_block=3, min_block_duration=0.25)

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
    _cap_stream_subtitle_durations(blocks)
    _trim_stream_blocks_to_speech(blocks, energy, _STREAM_LAG_HOP)
    if hasattr(rs, "clamp_block_display_duration"):
        rs.clamp_block_display_duration(blocks, max_sec=_STREAM_BLOCK_MAX_SEC)
    return blocks


def compose_stream_frame(
    frame: np.ndarray,
    facecam_roi: dict[str, Any] | None,
    game_rect: tuple[int, int, int, int] | None = None,
    *,
    out_w: int = OUT_W,
    out_h: int = OUT_H,
    top_h: int | None = None,
    bottom_h: int | None = None,
) -> np.ndarray:
    """Compose vertical stack: facecam top + gameplay bottom. No facecam → full center crop."""
    if top_h is None:
        top_h = max(1, int(round(STREAM_TOP_H * (out_h / float(OUT_H)))))
    if bottom_h is None:
        bottom_h = out_h - top_h
    src_h, src_w = frame.shape[:2]
    if facecam_roi is None:
        x0, y0, cw, ch = _cover_crop_rect(src_w, src_h, out_w, out_h, 0.5, 0.45)
        return _resize_cover(frame[y0 : y0 + ch, x0 : x0 + cw], out_w, out_h)

    top = _face_anchored_top(frame, facecam_roi, out_w, top_h)

    if game_rect is None:
        game_rect = gameplay_crop_rect(src_w, src_h, facecam_roi)
    gx, gy, gw, gh = game_rect
    gx = int(np.clip(gx, 0, max(0, src_w - gw)))
    gy = int(np.clip(gy, 0, max(0, src_h - gh)))
    game_crop = frame[gy : gy + gh, gx : gx + gw]
    bottom = _resize_cover(game_crop, out_w, bottom_h)

    out = np.zeros((out_h, out_w, 3), dtype=np.uint8)
    out[0:top_h, :] = top
    out[top_h : top_h + bottom_h, :] = bottom
    return out


def compose_stream_mono_frame(
    frame: np.ndarray,
    mono_face: dict[str, Any],
    *,
    out_w: int = OUT_W,
    out_h: int = OUT_H,
) -> np.ndarray:
    """
    Full-frame 9:16 bust crop when the streamer zoomed their cam (no gameplay).
    Stream-local — does not call talk smart-crop helpers.
    """
    src_h, src_w = frame.shape[:2]
    face_cx = float(mono_face.get("face_cx", 0.5))
    face_cy = float(mono_face.get("face_cy", 0.45))
    face_bw = float(mono_face.get("face_bw", 0.2))
    face_bh = float(mono_face.get("face_bh", 0.25))
    area = float(mono_face.get("area", face_bw * face_bh))

    ar = out_w / float(out_h)
    # Cover rect size in source
    if src_w / max(src_h, 1) > ar:
        ch = src_h
        cw = int(round(src_h * ar))
    else:
        cw = src_w
        ch = int(round(src_w / ar))

    # Mild zoom when face is small; cap when already huge (avoid pores)
    zoom = 1.12
    if area >= 0.12 or face_bh >= 0.35:
        zoom = 1.02
    elif area >= 0.07 or face_bh >= 0.25:
        zoom = 1.06
    elif area < 0.04:
        zoom = 1.18
    cw = max(32, int(round(cw / zoom)))
    ch = max(32, int(round(ch / zoom)))
    cw = min(cw, src_w)
    ch = min(ch, src_h)
    # Keep panel AR
    if cw / max(ch, 1) > ar:
        cw = max(32, int(round(ch * ar)))
    else:
        ch = max(32, int(round(cw / ar)))
    cw = min(cw, src_w)
    ch = min(ch, src_h)

    face_px = face_cx * src_w
    face_py = face_cy * src_h
    face_bh_px = max(8.0, face_bh * src_h)
    head_top_px = face_py - _FACE_TOP_EXTENT * face_bh_px
    chin_px = face_py + _FACE_BELOW_EXTENT * face_bh_px
    headroom = float(np.clip(FACE_HEADROOM, 0.03, 0.10))
    anchor = float(np.clip(FACE_ANCHOR_Y, 0.30, 0.50))

    x0 = int(np.clip(face_px - cw / 2.0, 0, max(0, src_w - cw)))
    y0_ideal = face_py - anchor * ch
    y0_headroom = head_top_px - headroom * ch
    y0_chin = chin_px - ch + 2
    y0 = min(y0_ideal, y0_headroom)
    y0 = max(y0, y0_chin)
    y0 = int(np.clip(y0, 0, max(0, src_h - ch)))

    crop = frame[y0 : y0 + ch, x0 : x0 + cw]
    return _resize_cover(crop, out_w, out_h)


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
    Frames decoded via ffmpeg (-ss after -i) — same clock as audio mux.
    """
    import render_subtitles as rs

    out_w = int(getattr(args, "out_width", None) or OUT_W)
    out_h = int(getattr(args, "out_height", None) or OUT_H)
    if out_w <= 0:
        out_w = OUT_W
    if out_h <= 0:
        out_h = OUT_H
    top_h = max(1, int(round(STREAM_TOP_H * (out_h / float(OUT_H)))))
    bottom_h = out_h - top_h
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
    layout = "stack"
    mono_face: dict[str, Any] | None = None
    facecam = _load_facecam_from_json(getattr(args, "stream_layout", None))
    if facecam is not None:
        # Explicit precomputed PiP JSON → always stack
        layout = "stack"
    else:
        samples = _sample_frames_for_detect(detect_path, args.start, args.end)
        layout, facecam, mono_face = classify_stream_layout(samples)

    fps_src, src_w, src_h = _probe_video_meta(args.video_path)
    game_rect = (
        gameplay_crop_rect(src_w, src_h, facecam)
        if layout == "stack" and facecam
        else None
    )

    clip_duration = max(0.05, float(args.end) - float(args.start))

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
    if layout == "mono" and mono_face is not None:
        print(
            f"[STREAM] render layout=mono "
            f"face=({mono_face['face_cx']:.2f},{mono_face['face_cy']:.2f}) "
            f"stride={stride} fps {fps_src:.3f}→{out_fps:.3f} frames={clip_frames_out} decode=ffmpeg",
            flush=True,
        )
    else:
        print(
            f"[STREAM] render layout=stack facecam={'yes' if facecam else 'fallback-center'} "
            f"stride={stride} fps {fps_src:.3f}→{out_fps:.3f} frames={clip_frames_out} decode=ffmpeg",
            flush=True,
        )

    t0 = time.monotonic()
    decode_proc = _spawn_ffmpeg_bgr_reader(
        args.video_path, args.start, clip_duration, out_fps, src_w, src_h
    )
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
    try:
        for i in range(clip_frames_out):
            frame = _read_bgr_frame(decode_proc, src_w, src_h)
            if frame is None:
                break

            t = i / out_fps
            if layout == "mono" and mono_face is not None:
                composed = compose_stream_mono_frame(
                    frame, mono_face, out_w=out_w, out_h=out_h
                )
            else:
                composed = compose_stream_frame(
                    frame,
                    facecam,
                    game_rect,
                    out_w=out_w,
                    out_h=out_h,
                    top_h=top_h,
                    bottom_h=bottom_h,
                )

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

            bloc = rs.bloc_for_display_at(
                rs.get_bloc_at_with_silence_gate(
                    t, blocks, silence_threshold=_STREAM_SILENCE_GATE_SEC
                ),
                t,
            )
            active_word = rs.get_word_at(t, bloc) if bloc else None
            layout_mode = (
                "stream_stack" if layout == "stack" and facecam is not None else "normal"
            )

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
    finally:
        try:
            if decode_proc.stdout:
                decode_proc.stdout.close()
        except Exception:
            pass
        try:
            decode_proc.kill()
        except Exception:
            pass
        try:
            decode_proc.wait(timeout=5)
        except Exception:
            pass

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
