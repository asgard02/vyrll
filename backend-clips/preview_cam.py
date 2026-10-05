#!/usr/bin/env python3
"""
Labellisation locale de la webcam gaming — même idée que preview_subtitles.

Usage:
  cd backend-clips && python3 preview_cam.py
  → http://127.0.0.1:8766

Colle des screens de VOD (Ctrl+V), trace le rectangle de la cam, le 9:16
se compose avec stream_layout. Tes choix sont écrits dans cam-lab/labels.json
(et chaque geste dans cam-lab/session.jsonl) — lisibles depuis Cursor.

Outil de dev uniquement (localhost). Pas branché au deploy.
"""

from __future__ import annotations

import base64
import importlib
import io
import json
import sys
import threading
import uuid
import webbrowser
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import cv2
import numpy as np
from PIL import Image

SCRIPT_DIR = Path(__file__).resolve().parent
HTML_PATH = SCRIPT_DIR / "preview_cam.html"
INBOX_PATH = SCRIPT_DIR / "preview_cam_inbox.html"
FX_HTML_PATH = SCRIPT_DIR / "preview_cam_fx.html"
CAM_LAB = SCRIPT_DIR / "cam-lab"
IMAGES_DIR = CAM_LAB / "images"
LABELS_PATH = CAM_LAB / "labels.json"
EVENTS_PATH = CAM_LAB / "session.jsonl"
HOST = "127.0.0.1"
PORT = 8766
PREVIEW_W = 540
PREVIEW_H = 960
MAX_BODY = 14 * 1024 * 1024

_lock = threading.Lock()
_sl = None
_rs = None
_fx_bg: dict[str, np.ndarray] = {}

FX_SAMPLE_TEXT = (
    "Donc en fait ce qui est hyper important "
    "c'est de vraiment comprendre le problème "
    "avant de chercher la solution"
)
FX_WORD_DURATION = 0.22
FX_STYLES = ("impact", "karaoke", "highlight", "neon", "boxed", "minimal")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _ensure_dirs() -> None:
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    if not LABELS_PATH.is_file():
        LABELS_PATH.write_text(
            json.dumps(
                {"version": 1, "updated_at": _now(), "labels": []},
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )


def _load_module(force: bool = False):
    global _sl
    with _lock:
        if _sl is None:
            if str(SCRIPT_DIR) not in sys.path:
                sys.path.insert(0, str(SCRIPT_DIR))
            import stream_layout as sl  # noqa: WPS433

            _sl = sl
        elif force:
            _sl = importlib.reload(_sl)
        return _sl


def _load_rs(force: bool = False):
    global _rs
    with _lock:
        if _rs is None:
            if str(SCRIPT_DIR) not in sys.path:
                sys.path.insert(0, str(SCRIPT_DIR))
            import render_subtitles as rs  # noqa: WPS433

            _rs = rs
        elif force:
            _rs = importlib.reload(_rs)
        return _rs


def _fx_sample_words() -> list[dict]:
    words: list[dict] = []
    t = 0.0
    for tok in FX_SAMPLE_TEXT.split():
        end = t + FX_WORD_DURATION
        words.append({"word": tok.upper(), "start": t, "end": end})
        t = end
    return words


def _fx_blocks(rs, style: str) -> list:
    words = _fx_sample_words()
    if style == "impact":
        return rs.group_into_blocks(words, max_per_block=2, min_block_duration=0.45)
    if style == "minimal":
        return rs.group_into_blocks(words, max_per_block=6, min_block_duration=0.9)
    return rs.group_into_blocks(words, max_per_block=3, min_block_duration=0.35)


def _fx_duration(rs) -> float:
    dur = 0.0
    for style in FX_STYLES:
        blocks = _fx_blocks(rs, style)
        if blocks:
            dur = max(dur, float(blocks[-1]["bloc_end"]))
    return dur


def _fx_background(sl, image_id: str) -> np.ndarray | None:
    with _lock:
        cached = _fx_bg.get(image_id)
        if cached is not None:
            return cached
    file_path = _image_path(image_id)
    if file_path is None:
        return None
    frame = _read_bgr(file_path)
    if frame is None:
        return None
    labels = {item.get("id"): item for item in _read_labels().get("labels") or []}
    rec = labels.get(image_id) or {}
    layout = rec.get("layout") if rec.get("layout") in ("stack", "mono", "no_cam") else "stack"
    roi = _normalize_roi(rec.get("roi"))
    game = _normalize_roi(rec.get("game"))
    face = rec.get("face") if isinstance(rec.get("face"), dict) else None
    composed = _compose(
        sl, frame, layout, roi, face, game, out_w=sl.OUT_W, out_h=sl.OUT_H
    )
    with _lock:
        _fx_bg[image_id] = composed
    return composed


def _render_fx_frame(
    sl,
    rs,
    image_id: str,
    style: str,
    t: float,
    *,
    flash: bool,
    subs: bool,
) -> bytes:
    import clip_fx

    bg = _fx_background(sl, image_id)
    if bg is None:
        raise FileNotFoundError("image introuvable")
    frame = bg.copy()
    if flash:
        frame = clip_fx.apply_intro_flash(frame, t)
    if subs:
        style = style if style in FX_STYLES else "impact"
        blocks = _fx_blocks(rs, style)
        bloc = rs.get_bloc_at_with_silence_gate(t, blocks)
        if bloc is not None:
            active = rs.get_word_at(t, bloc)
            font_path = rs._resolve_font_path(None)
            overlay = rs.render_subtitle_frame(
                frame.shape[1],
                frame.shape[0],
                bloc,
                active,
                style,
                font_path,
                layout_mode="stream_stack",
            )
            frame = rs.blend_overlay(frame, overlay)
    return _png_bytes(frame)


def _read_labels() -> dict:
    _ensure_dirs()
    try:
        data = json.loads(LABELS_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        data = {"version": 1, "labels": []}
    data.setdefault("version", 1)
    data.setdefault("labels", [])
    return data


def _write_labels(data: dict) -> None:
    data["updated_at"] = _now()
    tmp = LABELS_PATH.with_suffix(".json.tmp")
    tmp.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    tmp.replace(LABELS_PATH)


def _append_event(payload: dict) -> None:
    _ensure_dirs()
    row = dict(payload)
    row.setdefault("t", _now())
    with EVENTS_PATH.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(row, ensure_ascii=False) + "\n")


def _image_path(image_id: str) -> Path | None:
    if not image_id or "/" in image_id or "\\" in image_id or ".." in image_id:
        return None
    path = IMAGES_DIR / f"{image_id}.png"
    return path if path.is_file() else None


def _read_bgr(path: Path) -> np.ndarray | None:
    raw = np.fromfile(str(path), dtype=np.uint8)
    if raw.size == 0:
        return None
    return cv2.imdecode(raw, cv2.IMREAD_COLOR)


def _png_bytes(bgr: np.ndarray) -> bytes:
    ok, buf = cv2.imencode(".png", bgr)
    if not ok:
        raise RuntimeError("png encode failed")
    return buf.tobytes()


def _clamp01(v: float) -> float:
    return float(min(1.0, max(0.0, v)))


def _normalize_roi(roi: dict | None) -> dict | None:
    if not roi:
        return None
    x = _clamp01(float(roi.get("x", 0)))
    y = _clamp01(float(roi.get("y", 0)))
    w = float(min(1.0 - x, max(0.01, float(roi.get("w", 0.18)))))
    h = float(min(1.0 - y, max(0.01, float(roi.get("h", 0.24)))))
    return {"x": x, "y": y, "w": w, "h": h}


def _face_xy(face: dict | None) -> tuple[float | None, float | None]:
    if not face:
        return None, None
    cx = face.get("cx", face.get("cx"))
    cy = face.get("cy", face.get("cy"))
    if cx is None or cy is None:
        return None, None
    return _clamp01(float(cx)), _clamp01(float(cy))


def _roi_to_facecam(sl, roi: dict, face: dict | None) -> dict:
    x, y, w, h = roi["x"], roi["y"], roi["w"], roi["h"]
    cx, cy = _face_xy(face)
    if cx is None or cy is None:
        cx = x + w / 2.0
        cy = y + h * 0.38
    bw = float((face or {}).get("bw") or w * 0.42)
    bh = float((face or {}).get("bh") or h * 0.40)
    edge = sl._edge_label(cx, cy)
    return {
        "x": x,
        "y": y,
        "w": w,
        "h": h,
        "corner": edge,
        "face_cx": cx,
        "face_cy": cy,
        "face_bw": float(np.clip(bw, 0.02, w)),
        "face_bh": float(np.clip(bh, 0.02, h)),
        "confidence": 99.0,
    }


def _game_rect_px(frame: np.ndarray, game: dict | None) -> tuple[int, int, int, int] | None:
    if not game:
        return None
    src_h, src_w = frame.shape[:2]
    x = int(np.clip(round(float(game["x"]) * src_w), 0, max(0, src_w - 16)))
    y = int(np.clip(round(float(game["y"]) * src_h), 0, max(0, src_h - 16)))
    w = max(16, int(round(float(game["w"]) * src_w)))
    h = max(16, int(round(float(game["h"]) * src_h)))
    w = min(w, src_w - x)
    h = min(h, src_h - y)
    return x, y, w, h


def _compose(
    sl,
    frame: np.ndarray,
    layout: str,
    roi: dict | None,
    face: dict | None,
    game: dict | None = None,
    out_w: int = PREVIEW_W,
    out_h: int = PREVIEW_H,
) -> np.ndarray:
    game_rect = _game_rect_px(frame, game)
    if layout == "no_cam" or roi is None:
        if game_rect is not None:
            gx, gy, gw, gh = game_rect
            crop = frame[gy : gy + gh, gx : gx + gw]
            return sl._resize_cover(crop, out_w, out_h)
        return sl.compose_stream_frame(frame, None, out_w=out_w, out_h=out_h)
    facecam = _roi_to_facecam(sl, roi, face)
    if layout == "mono":
        return sl.compose_stream_mono_frame(frame, facecam, out_w=out_w, out_h=out_h)
    return sl.compose_stream_frame(
        frame, facecam, game_rect, out_w=out_w, out_h=out_h
    )


def _boost_still(frame: np.ndarray) -> np.ndarray:
    lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
    luma, a, b = cv2.split(lab)
    luma = cv2.createCLAHE(clipLimit=2.2, tileGridSize=(8, 8)).apply(luma)
    return cv2.cvtColor(cv2.merge((luma, a, b)), cv2.COLOR_LAB2BGR)


def _dense_faces(sl, frame: np.ndarray) -> list:
    """Search overlay strips only — full-frame tiles invent corkboard/HUD faces."""
    faces = list(sl._faces_on_frame(frame) or [])
    h, w = frame.shape[:2]
    left = max(96, int(w * 0.36))
    right = min(w, int(w * 0.64))
    bands = [
        (0, 0, left, h),
        (right, 0, w, h),
    ]
    tw = max(96, int(w * 0.26))
    th = max(96, int(h * 0.30))
    step_x = max(40, int(w * 0.16))
    step_y = max(40, int(h * 0.18))
    for bx0, by0, bx1, by1 in bands:
        for y0 in range(by0, max(by0 + 1, by1 - th + 1), step_y):
            for x0 in range(bx0, max(bx0 + 1, bx1 - tw + 1), step_x):
                x1 = min(bx1, x0 + tw)
                y1 = min(by1, y0 + th)
                if x1 - x0 < 80 or y1 - y0 < 80:
                    continue
                crop = np.ascontiguousarray(frame[y0:y1, x0:x1])
                local = sl._detect_faces_in_bgr(crop)
                if not local:
                    continue
                span_x = (x1 - x0) / w
                span_y = (y1 - y0) / h
                for lcx, lcy, larea, lbw, lbh, has_eyes in local:
                    cx = x0 / w + lcx * span_x
                    cy = y0 / h + lcy * span_y
                    if not sl._is_overlay_cam_zone(cx, cy):
                        continue
                    area = larea * span_x * span_y
                    bw = lbw * span_x
                    bh = lbh * span_y
                    dup = False
                    for ecx, ecy, *_rest in faces:
                        if (cx - ecx) ** 2 + (cy - ecy) ** 2 < 0.012**2:
                            dup = True
                            break
                    if not dup:
                        faces.append((float(cx), float(cy), float(area), float(bw), float(bh), bool(has_eyes)))
    return faces


def _lab_pick_face(sl, frame: np.ndarray, faces: list) -> dict | None:
    if not faces:
        return None
    scores, skins, props = sl._pip_scores_for_faces(frame, faces)
    idx = sl._select_best_pip_face(faces, scores, skins, props)
    if idx is None:
        return None
    cx, cy, _area, bw, bh, _eyes = faces[idx]
    roi = sl._roi_from_face(cx, cy, bw, bh)
    roi["confidence"] = float(scores[idx]) if 0 <= idx < len(scores) else 1.0
    return roi


def _model_guess(sl, frame: np.ndarray) -> dict | None:
    """Still-friendly cam find. Never lock a sticker/HUD if no overlay cam exists."""
    roi = sl.detect_facecam_roi([frame, frame, frame, frame, frame])
    if roi:
        return roi
    faces = _dense_faces(sl, frame)
    picked = _lab_pick_face(sl, frame, faces)
    if picked:
        print(
            f"[LAB] facecam still-fallback "
            f"roi=({picked['x']:.2f},{picked['y']:.2f},{picked['w']:.2f},{picked['h']:.2f}) "
            f"face=({picked['face_cx']:.2f},{picked['face_cy']:.2f})",
            flush=True,
        )
        return picked
    # CLAHE can hallucinate faces on weapons/icons — only keep an overlay-zone hit.
    boosted = _boost_still(frame)
    roi = sl.detect_facecam_roi([boosted, boosted, boosted])
    if roi and sl._is_overlay_cam_zone(float(roi.get("face_cx") or 0.5), float(roi.get("face_cy") or 0.5)):
        roi["confidence"] = float(roi.get("confidence") or 1.0) * 0.85
        return roi
    return None


def _list_images() -> list[dict]:
    labels = {item.get("id"): item for item in _read_labels().get("labels") or []}
    out: list[dict] = []
    paths = sorted(IMAGES_DIR.glob("*.png"), key=lambda p: p.stat().st_mtime, reverse=True)
    for path in paths:
        image_id = path.stem
        rec = labels.get(image_id) or {}
        out.append(
            {
                "id": image_id,
                "url": f"/images/{image_id}.png",
                "src_w": rec.get("src_w"),
                "src_h": rec.get("src_h"),
                "labeled": bool(rec.get("roi") or rec.get("game") or rec.get("layout") == "no_cam"),
                "layout": rec.get("layout") or "stack",
                "corner": (rec.get("roi") or {}).get("corner") or rec.get("corner"),
                "updated_at": rec.get("updated_at"),
            }
        )
    return out


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    def _send(self, code: int, body: bytes, content_type: str, *, no_cache: bool = True) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        if no_cache:
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, code: int, payload: dict | list) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self._send(code, body, "application/json; charset=utf-8")

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            raise ValueError("body too large")
        raw = self.rfile.read(length) if length else b"{}"
        if not raw:
            return {}
        data = json.loads(raw.decode("utf-8"))
        if not isinstance(data, dict):
            raise ValueError("json object required")
        return data

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path

        if path in ("/", "/index.html", "/inbox"):
            if not INBOX_PATH.is_file():
                self._send(500, b"preview_cam_inbox.html missing", "text/plain")
                return
            self._send(200, INBOX_PATH.read_bytes(), "text/html; charset=utf-8")
            return

        if path in ("/lab", "/lab.html"):
            if not HTML_PATH.is_file():
                self._send(500, b"preview_cam.html missing", "text/plain")
                return
            self._send(200, HTML_PATH.read_bytes(), "text/html; charset=utf-8")
            return

        if path in ("/fx", "/fx.html"):
            if not FX_HTML_PATH.is_file():
                self._send(500, b"preview_cam_fx.html missing", "text/plain")
                return
            self._send(200, FX_HTML_PATH.read_bytes(), "text/html; charset=utf-8")
            return

        if path == "/api/fx/meta":
            sl = _load_module()
            rs = _load_rs()
            import clip_fx

            images = _list_images()
            default_id = images[0]["id"] if images else ""
            self._send_json(
                200,
                {
                    "sample_text": FX_SAMPLE_TEXT,
                    "styles": list(FX_STYLES),
                    "duration": _fx_duration(rs),
                    "images": images,
                    "default_id": default_id,
                    "flash_end": clip_fx.FLASH_END_T,
                    "frame": {"width": sl.OUT_W, "height": sl.OUT_H},
                    "sfx": clip_fx.shutter_catalog(),
                    "sfx_default": clip_fx.DEFAULT_SHUTTER_ID,
                },
            )
            return

        if path == "/api/fx/frame.png":
            qs = parse_qs(parsed.query)
            image_id = (qs.get("id") or [""])[0]
            style = (qs.get("style") or ["impact"])[0]
            try:
                t = float((qs.get("t") or ["0"])[0])
            except ValueError:
                t = 0.0
            flash = (qs.get("flash") or ["1"])[0] != "0"
            subs = (qs.get("subs") or ["1"])[0] != "0"
            try:
                sl = _load_module()
                rs = _load_rs()
                png = _render_fx_frame(sl, rs, image_id, style, t, flash=flash, subs=subs)
            except FileNotFoundError:
                self._send(404, b"image introuvable", "text/plain")
                return
            except Exception as exc:  # noqa: BLE001
                self._send(500, str(exc).encode("utf-8"), "text/plain; charset=utf-8")
                return
            self._send(200, png, "image/png")
            return

        if path == "/api/fx/shutter.wav":
            import clip_fx

            qs = parse_qs(parsed.query)
            sid = (qs.get("id") or [clip_fx.DEFAULT_SHUTTER_ID])[0]
            try:
                wav = clip_fx.ensure_camera_shutter_wav(sid)
            except FileNotFoundError:
                self._send(404, b"shutter introuvable", "text/plain")
                return
            self._send(200, wav.read_bytes(), "audio/wav")
            return

        if path == "/api/meta":
            sl = _load_module()
            self._send_json(
                200,
                {
                    "frame": {"width": sl.OUT_W, "height": sl.OUT_H},
                    "stream_top_h": sl.STREAM_TOP_H,
                    "stream_bottom_h": sl.STREAM_BOTTOM_H,
                    "constants": {
                        "FACE_ANCHOR_Y": sl.FACE_ANCHOR_Y,
                        "FACE_HEADROOM": sl.FACE_HEADROOM,
                        "PIP_BORDER_INSET": sl.PIP_BORDER_INSET,
                        "_CORE_MARGIN_X": sl._CORE_MARGIN_X,
                        "_CORE_TOP": sl._CORE_TOP,
                        "_FACE_MIN_AREA": sl._FACE_MIN_AREA,
                        "_FACE_MAX_AREA": sl._FACE_MAX_AREA,
                    },
                    "images": _list_images(),
                    "labels": _read_labels(),
                },
            )
            return

        if path == "/api/labels":
            self._send_json(200, _read_labels())
            return

        if path.startswith("/images/"):
            name = unquote(path.split("/", 2)[-1])
            image_id = name.removesuffix(".png")
            file_path = _image_path(image_id)
            if file_path is None:
                self._send(404, b"not found", "text/plain")
                return
            self._send(200, file_path.read_bytes(), "image/png")
            return

        self._send(404, b"not found", "text/plain")

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path

        try:
            if path == "/api/reload":
                sl = _load_module(force=True)
                _load_rs(force=True)
                import clip_fx

                importlib.reload(clip_fx)
                with _lock:
                    _fx_bg.clear()
                self._send_json(200, {"ok": True, "stream_top_h": sl.STREAM_TOP_H})
                return

            if path == "/api/upload":
                payload = self._read_json()
                data_url = str(payload.get("data") or "")
                if "," in data_url:
                    data_url = data_url.split(",", 1)[1]
                raw = base64.b64decode(data_url)
                img = Image.open(io.BytesIO(raw)).convert("RGB")
                image_id = uuid.uuid4().hex[:10]
                _ensure_dirs()
                img.save(IMAGES_DIR / f"{image_id}.png", format="PNG", optimize=True)
                rec = {
                    "id": image_id,
                    "url": f"/images/{image_id}.png",
                    "src_w": img.width,
                    "src_h": img.height,
                    "labeled": False,
                    "layout": "stack",
                }
                _append_event({"op": "paste", "id": image_id, "src_w": img.width, "src_h": img.height})
                self._send_json(200, rec)
                return

            if path == "/api/events":
                _append_event(self._read_json())
                self._send_json(200, {"ok": True})
                return

            if path == "/api/labels":
                payload = self._read_json()
                image_id = str(payload.get("id") or "")
                if _image_path(image_id) is None:
                    self._send_json(404, {"error": "image introuvable"})
                    return
                roi = _normalize_roi(payload.get("roi"))
                game = _normalize_roi(payload.get("game"))
                face = payload.get("face") if isinstance(payload.get("face"), dict) else None
                layout = payload.get("layout")
                if layout not in ("stack", "mono", "no_cam"):
                    layout = "stack"
                sl = _load_module()
                corner = None
                if roi:
                    facecam = _roi_to_facecam(sl, roi, face)
                    corner = facecam["corner"]
                    roi = {**roi, "corner": corner}
                cx, cy = _face_xy(face)
                label = {
                    "id": image_id,
                    "image": f"images/{image_id}.png",
                    "src_w": payload.get("src_w"),
                    "src_h": payload.get("src_h"),
                    "layout": layout,
                    "roi": roi,
                    "game": game,
                    "corner": corner,
                    "face": {"cx": cx, "cy": cy, "bw": (face or {}).get("bw"), "bh": (face or {}).get("bh")}
                    if cx is not None
                    else None,
                    "notes": str(payload.get("notes") or "")[:500],
                    "model": payload.get("model"),
                    "updated_at": _now(),
                }
                data = _read_labels()
                data["labels"] = [item for item in data["labels"] if item.get("id") != image_id]
                data["labels"].append(label)
                _write_labels(data)
                _append_event({"op": "save", "id": image_id, "label": label})
                with _lock:
                    _fx_bg.pop(image_id, None)
                self._send_json(200, {"ok": True, "label": label})
                return

            if path in ("/api/compose", "/api/detect"):
                payload = self._read_json()
                image_id = str(payload.get("id") or "")
                file_path = _image_path(image_id)
                if file_path is None:
                    self._send_json(404, {"error": "image introuvable"})
                    return
                frame = _read_bgr(file_path)
                if frame is None:
                    self._send_json(500, {"error": "lecture image échouée"})
                    return
                sl = _load_module()

                if path == "/api/detect":
                    roi = _model_guess(sl, frame)
                    guess = None
                    game_guess = None
                    if roi:
                        guess = {
                            "x": round(float(roi["x"]), 4),
                            "y": round(float(roi["y"]), 4),
                            "w": round(float(roi["w"]), 4),
                            "h": round(float(roi["h"]), 4),
                            "corner": roi.get("corner"),
                            "face": {
                                "cx": round(float(roi.get("face_cx") or 0), 4),
                                "cy": round(float(roi.get("face_cy") or 0), 4),
                                "bw": round(float(roi.get("face_bw") or 0), 4),
                                "bh": round(float(roi.get("face_bh") or 0), 4),
                            },
                            "confidence": round(float(roi.get("confidence") or 0), 3),
                        }
                        src_h, src_w = frame.shape[:2]
                        gx, gy, gw, gh = sl.gameplay_crop_rect(src_w, src_h, roi)
                        game_guess = {
                            "x": round(gx / max(src_w, 1), 4),
                            "y": round(gy / max(src_h, 1), 4),
                            "w": round(gw / max(src_w, 1), 4),
                            "h": round(gh / max(src_h, 1), 4),
                        }
                    _append_event(
                        {
                            "op": "detect",
                            "id": image_id,
                            "model": guess,
                            "game": game_guess,
                        }
                    )
                    self._send_json(200, {"ok": True, "model": guess, "game": game_guess})
                    return

                layout = payload.get("layout")
                if layout not in ("stack", "mono", "no_cam"):
                    layout = "stack"
                roi = _normalize_roi(payload.get("roi"))
                game = _normalize_roi(payload.get("game"))
                face = payload.get("face") if isinstance(payload.get("face"), dict) else None
                composed = _compose(sl, frame, layout, roi, face, game)
                self._send(200, _png_bytes(composed), "image/png")
                return

            if path == "/api/delete":
                payload = self._read_json()
                image_id = str(payload.get("id") or "")
                file_path = _image_path(image_id)
                if file_path is None:
                    self._send_json(404, {"error": "image introuvable"})
                    return
                file_path.unlink(missing_ok=True)
                data = _read_labels()
                data["labels"] = [item for item in data["labels"] if item.get("id") != image_id]
                _write_labels(data)
                _append_event({"op": "delete", "id": image_id})
                with _lock:
                    _fx_bg.pop(image_id, None)
                self._send_json(200, {"ok": True})
                return

        except Exception as exc:  # noqa: BLE001
            self._send_json(500, {"error": str(exc)})
            return

        self._send(404, b"not found", "text/plain")


def main() -> None:
    _ensure_dirs()
    print("Chargement de stream_layout (BlazeFace / OpenCV)…", flush=True)
    _load_module()
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    url = f"http://{HOST}:{PORT}/"
    print(f"Collecte screens → {url}", flush=True)
    print(f"Lab cam → {url}lab", flush=True)
    print(f"Clip FX → {url}fx", flush=True)
    print(f"Labels → {LABELS_PATH}", flush=True)
    print("Colle sur la page collecte, puis ouvre le lab ou Clip FX.", flush=True)
    try:
        webbrowser.open(url)
    except Exception:  # noqa: BLE001
        pass
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nArrêt.", flush=True)
        httpd.server_close()


if __name__ == "__main__":
    main()
