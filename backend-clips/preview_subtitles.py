#!/usr/bin/env python3
"""
Preview locale des sous-titres — vrai rendu Pillow (render_subtitles.py).

Usage:
  cd backend-clips && python3 preview_subtitles.py
  → http://127.0.0.1:8765

Outil de dev uniquement (localhost). Pas branché au deploy.
"""

from __future__ import annotations

import importlib
import io
import json
import sys
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import numpy as np
from PIL import Image

SCRIPT_DIR = Path(__file__).resolve().parent
HTML_PATH = SCRIPT_DIR / "preview_subtitles.html"
TITLES_HTML_PATH = SCRIPT_DIR / "preview_titles.html"
HOST = "127.0.0.1"
PORT = 8765
FRAME_W = 1080
FRAME_H = 1920
PREVIEW_W = 540
PREVIEW_H = 960
T_STEP = 0.08

SAMPLE_TEXT = (
    "Donc en fait ce qui est hyper important "
    "c'est de vraiment comprendre le problème "
    "avant de chercher la solution"
)
WORD_DURATION = 0.22

NEW_STYLES = ("bubble", "bold", "editorial", "serif", "impact", "neon")
LEGACY_STYLES: tuple[str, ...] = ()
ALL_STYLES = NEW_STYLES
NEW_SET = frozenset(("bubble", "bold", "editorial", "serif"))

STYLE_LABELS = {
    "bubble": "Bulle",
    "bold": "Gros blanc",
    "editorial": "Éditorial",
    "serif": "Serif",
    "impact": "Impact",
    "neon": "Néon",
}

_lock = threading.Lock()
_rs = None
_titles = None
_blocks_cache: dict[str, list] = {}
_bg_rgb: np.ndarray | None = None
_title_bg_rgb: np.ndarray | None = None
_frame_cache: dict[tuple[str, int], bytes] = {}
_title_cache: dict[str, bytes] = {}
_cache_lock = threading.Lock()
_cache_epoch = 0


def _load_module(force: bool = False):
    global _rs, _titles
    with _lock:
        if str(SCRIPT_DIR) not in sys.path:
            sys.path.insert(0, str(SCRIPT_DIR))
        if _rs is None:
            import render_subtitles as rs  # noqa: WPS433

            _rs = rs
        elif force:
            _rs = importlib.reload(_rs)
        if _titles is None:
            import hook_title_styles as titles  # noqa: WPS433

            _titles = titles
        elif force:
            _titles = importlib.reload(_titles)
        return _rs


def _sample_words(style: str) -> list[dict]:
    tokens = SAMPLE_TEXT.split()
    upper = style not in NEW_SET
    words: list[dict] = []
    t = 0.0
    for tok in tokens:
        end = t + WORD_DURATION
        token = tok.upper() if upper else tok
        words.append({"word": token, "start": t, "end": end})
        t = end
    return words


def _clear_render_cache() -> None:
    global _blocks_cache, _bg_rgb, _title_bg_rgb, _frame_cache, _title_cache, _cache_epoch
    with _cache_lock:
        _blocks_cache = {}
        _bg_rgb = None
        _title_bg_rgb = None
        _frame_cache = {}
        _title_cache = {}
        _cache_epoch += 1


def _t_key(t: float) -> int:
    return int(round(max(0.0, float(t)) / T_STEP))


def _blocks_for_style(rs, style: str) -> list:
    cached = _blocks_cache.get(style)
    if cached is not None:
        return cached
    words = _sample_words(style)
    if style == "impact":
        blocks = rs.group_into_blocks(words, max_per_block=2, min_block_duration=0.45)
    elif style in ("minimal", "bubble", "serif"):
        blocks = rs.group_into_blocks(words, max_per_block=6, min_block_duration=0.9)
    elif style == "editorial":
        blocks = rs.group_into_blocks(words, max_per_block=5, min_block_duration=0.7)
    elif style == "bold":
        blocks = rs.group_into_blocks(words, max_per_block=4, min_block_duration=0.55)
    else:
        blocks = rs.group_into_blocks(words, max_per_block=3, min_block_duration=0.35)
    _blocks_cache[style] = blocks
    return blocks


def _total_duration(blocks: list) -> float:
    if not blocks:
        return 0.0
    return float(blocks[-1]["bloc_end"])


def _meta(rs) -> dict:
    blocks_by_style = {s: _blocks_for_style(rs, s) for s in ALL_STYLES}
    duration = max((_total_duration(b) for b in blocks_by_style.values()), default=0.0)
    colors = {k: rs.STYLE_COLORS[k] for k in ALL_STYLES if k in rs.STYLE_COLORS}
    return {
        "sample_text": SAMPLE_TEXT,
        "styles": list(ALL_STYLES),
        "new_styles": list(NEW_STYLES),
        "legacy_styles": list(LEGACY_STYLES),
        "labels": {k: STYLE_LABELS.get(k, k) for k in ALL_STYLES},
        "duration": duration,
        "word_count": len(_sample_words("bubble")),
        "frame": {"width": PREVIEW_W, "height": PREVIEW_H},
        "t_step": T_STEP,
        "cache_epoch": _cache_epoch,
        "colors": colors,
        "variants": {k: rs.STYLE_VARIANTS.get(k) for k in ALL_STYLES},
    }


def _titles_meta() -> dict:
    titles = _titles
    return {
        "sample_text": titles.SAMPLE_HOOK,
        "styles": list(titles.STYLE_IDS),
        "labels": dict(titles.LABELS),
        "notes": dict(titles.NOTES),
        "frame": {"width": PREVIEW_W, "height": PREVIEW_H},
        "cache_epoch": _cache_epoch,
    }


def _background() -> np.ndarray:
    global _bg_rgb
    if _bg_rgb is not None:
        return _bg_rgb
    bg = np.empty((FRAME_H, FRAME_W, 3), dtype=np.uint8)
    bg[:] = (32, 28, 26)
    yy = np.linspace(0, 1, FRAME_H, dtype=np.float32)[:, None]
    xx = np.linspace(0, 1, FRAME_W, dtype=np.float32)[None, :]
    lift_y = (28 * (1.0 - yy)).astype(np.int16)
    lift_x = (12 * xx).astype(np.int16)
    bg[:, :, 0] = np.clip(bg[:, :, 0].astype(np.int16) + lift_y + 8, 0, 255).astype(np.uint8)
    bg[:, :, 1] = np.clip(bg[:, :, 1].astype(np.int16) + lift_y - 4, 0, 255).astype(np.uint8)
    bg[:, :, 2] = np.clip(bg[:, :, 2].astype(np.int16) + lift_y + lift_x, 0, 255).astype(np.uint8)
    _bg_rgb = bg
    return bg


def _encode_preview(composed: np.ndarray) -> bytes:
    img = Image.fromarray(composed, mode="RGB")
    img = img.resize((PREVIEW_W, PREVIEW_H), Image.Resampling.BILINEAR)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=82, subsampling=1)
    return buf.getvalue()


def _render_frame(rs, style: str, t: float) -> bytes:
    style = style if style in ALL_STYLES else "bubble"
    key = (style, _t_key(t))
    with _cache_lock:
        hit = _frame_cache.get(key)
    if hit is not None:
        return hit

    t_q = key[1] * T_STEP
    blocks = _blocks_for_style(rs, style)
    bloc = rs.get_bloc_at_with_silence_gate(t_q, blocks)
    if bloc is None:
        overlay = np.zeros((FRAME_H, FRAME_W, 4), dtype=np.uint8)
    else:
        active = rs.get_word_at(t_q, bloc)
        font_path = rs._resolve_font_path(None)
        overlay = rs.render_subtitle_frame(
            FRAME_W, FRAME_H, bloc, active, style, font_path, layout_mode="normal"
        )

    bg = _background()
    alpha = overlay[:, :, 3:4].astype(np.float32) / 255.0
    rgb = overlay[:, :, :3].astype(np.float32)
    composed = (rgb * alpha + bg.astype(np.float32) * (1.0 - alpha)).astype(np.uint8)
    jpeg = _encode_preview(composed)
    with _cache_lock:
        _frame_cache[key] = jpeg
    return jpeg


def _title_background() -> np.ndarray:
    global _title_bg_rgb
    if _title_bg_rgb is not None:
        return _title_bg_rgb
    titles = _titles
    _title_bg_rgb = titles.video_background(FRAME_W, FRAME_H)
    return _title_bg_rgb


def _render_title(style: str) -> bytes:
    titles = _titles
    style = style if style in titles.STYLE_IDS else "actuel"
    with _cache_lock:
        hit = _title_cache.get(style)
    if hit is not None:
        return hit
    overlay = titles.render_hook_title(FRAME_W, FRAME_H, titles.SAMPLE_HOOK, style)
    bg = _title_background()
    if overlay is None:
        composed = bg
    else:
        alpha = overlay[:, :, 3:4].astype(np.float32) / 255.0
        rgb = overlay[:, :, :3].astype(np.float32)
        composed = (rgb * alpha + bg.astype(np.float32) * (1.0 - alpha)).astype(np.uint8)
    jpeg = _encode_preview(composed)
    with _cache_lock:
        _title_cache[style] = jpeg
    return jpeg


def _warm_styles(rs, styles: tuple[str, ...], times: list[float]) -> None:
    for style in styles:
        for t in times:
            _render_frame(rs, style, t)


def _start_warmup(rs) -> None:
    def run():
        epoch = _cache_epoch
        extras = [0.4, 0.88, 1.4, 2.0]
        try:
            for style in ALL_STYLES:
                for t in extras:
                    if epoch != _cache_epoch:
                        return
                    time.sleep(0.04)
                    _render_frame(rs, style, t)
        except Exception as exc:  # noqa: BLE001
            print(f"[lab] warmup skipped: {exc}", flush=True)

    threading.Thread(target=run, name="lab-warmup", daemon=True).start()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        msg = fmt % args if args else fmt
        if "/frame" in msg:
            return
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), msg))

    def _send(self, code: int, body: bytes, content_type: str, *, no_cache: bool = True) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        if no_cache:
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self._send(code, body, "application/json; charset=utf-8")

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        if path in ("/", "/index.html"):
            if not HTML_PATH.is_file():
                self._send(500, b"preview_subtitles.html missing", "text/plain")
                return
            self._send(200, HTML_PATH.read_bytes(), "text/html; charset=utf-8")
            return

        if path in ("/titles", "/titles.html"):
            if not TITLES_HTML_PATH.is_file():
                self._send(500, b"preview_titles.html missing", "text/plain")
                return
            self._send(200, TITLES_HTML_PATH.read_bytes(), "text/html; charset=utf-8")
            return

        if path == "/api/meta":
            rs = _load_module()
            self._send_json(200, _meta(rs))
            return

        if path == "/api/reload":
            _clear_render_cache()
            rs = _load_module(force=True)
            _start_warmup(rs)
            self._send_json(200, {"ok": True, "meta": _meta(rs), "titles": _titles_meta()})
            return

        if path == "/api/titles/meta":
            _load_module()
            self._send_json(200, _titles_meta())
            return

        if path in ("/frame.png", "/frame.jpg", "/frame.jpeg"):
            style = (qs.get("style") or ["bubble"])[0]
            try:
                t = float((qs.get("t") or ["0"])[0])
            except ValueError:
                t = 0.0
            try:
                rs = _load_module()
                jpeg = _render_frame(rs, style, t)
            except Exception as exc:  # noqa: BLE001 — surface error to UI
                self._send(500, str(exc).encode("utf-8"), "text/plain; charset=utf-8")
                return
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(jpeg)))
            self.send_header("Cache-Control", "public, max-age=120")
            self.end_headers()
            self.wfile.write(jpeg)
            return

        if path in ("/title.jpg", "/title.jpeg", "/title.png"):
            style = (qs.get("style") or ["actuel"])[0]
            try:
                _load_module()
                jpeg = _render_title(style)
            except Exception as exc:  # noqa: BLE001
                self._send(500, str(exc).encode("utf-8"), "text/plain; charset=utf-8")
                return
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(jpeg)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(jpeg)
            return

        self._send(404, b"not found", "text/plain")

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/api/reload":
            _clear_render_cache()
            rs = _load_module(force=True)
            _start_warmup(rs)
            self._send_json(200, {"ok": True, "meta": _meta(rs), "titles": _titles_meta()})
            return
        self._send(404, b"not found", "text/plain")


def main() -> None:
    print("Chargement de render_subtitles (Pillow)…", flush=True)
    rs = _load_module()
    _background()
    _warm_styles(rs, ALL_STYLES, [0.0])
    _start_warmup(rs)
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    httpd.daemon_threads = True
    url = f"http://{HOST}:{PORT}/"
    print(f"Preview sous-titres → {url}", flush=True)
    print(f"Preview titres      → {url}titles", flush=True)
    print("Modifie render_subtitles.py puis clique « Recharger le moteur ».", flush=True)
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
