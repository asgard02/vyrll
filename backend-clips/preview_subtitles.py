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
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import numpy as np
from PIL import Image

SCRIPT_DIR = Path(__file__).resolve().parent
HTML_PATH = SCRIPT_DIR / "preview_subtitles.html"
HOST = "127.0.0.1"
PORT = 8765
FRAME_W = 1080
FRAME_H = 1920

# Texte FR fixe (style podcast) — même phrase à chaque preview.
SAMPLE_TEXT = (
    "Donc en fait ce qui est hyper important "
    "c'est de vraiment comprendre le problème "
    "avant de chercher la solution"
)
WORD_DURATION = 0.22  # secondes par mot (timings factices)
PUBLIC_STYLES = ("impact", "karaoke", "highlight", "neon", "boxed", "minimal")

_lock = threading.Lock()
_rs = None  # module render_subtitles (rechargeable)


def _load_module(force: bool = False):
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


def _sample_words() -> list[dict]:
    tokens = SAMPLE_TEXT.split()
    words: list[dict] = []
    t = 0.0
    for tok in tokens:
        end = t + WORD_DURATION
        words.append({"word": tok.upper(), "start": t, "end": end})
        t = end
    return words


def _blocks_for_style(rs, style: str) -> list:
    words = _sample_words()
    if style == "impact":
        return rs.group_into_blocks(words, max_per_block=2, min_block_duration=0.45)
    if style == "minimal":
        return rs.group_into_blocks(words, max_per_block=6, min_block_duration=0.9)
    return rs.group_into_blocks(words, max_per_block=3, min_block_duration=0.35)


def _total_duration(blocks: list) -> float:
    if not blocks:
        return 0.0
    return float(blocks[-1]["bloc_end"])


def _meta(rs) -> dict:
    blocks_by_style = {s: _blocks_for_style(rs, s) for s in PUBLIC_STYLES}
    # Durée basée sur impact (même mots, blocs plus courts) → max de toutes les durées
    duration = max((_total_duration(b) for b in blocks_by_style.values()), default=0.0)
    colors = {k: rs.STYLE_COLORS[k] for k in PUBLIC_STYLES if k in rs.STYLE_COLORS}
    return {
        "sample_text": SAMPLE_TEXT,
        "styles": list(PUBLIC_STYLES),
        "duration": duration,
        "word_count": len(_sample_words()),
        "frame": {"width": FRAME_W, "height": FRAME_H},
        "colors": colors,
        "variants": {k: rs.STYLE_VARIANTS.get(k) for k in PUBLIC_STYLES},
        "constants": {
            "SAFE_BOTTOM_RATIO": getattr(rs, "SAFE_BOTTOM_RATIO", None),
            "SAFE_CHROME_RATIO": getattr(rs, "SAFE_CHROME_RATIO", None),
            "OUTLINE_RADIUS": getattr(rs, "OUTLINE_RADIUS", None),
            "OUTLINE_RADIUS_IMPACT": getattr(rs, "OUTLINE_RADIUS_IMPACT", None),
            "ACTIVE_WORD_POP": getattr(rs, "ACTIVE_WORD_POP", None),
            "KARAOKE_PAD_X": getattr(rs, "KARAOKE_PAD_X", None),
            "KARAOKE_WORD_GAP": getattr(rs, "KARAOKE_WORD_GAP", None),
        },
    }


def _render_frame(rs, style: str, t: float) -> bytes:
    style = style if style in PUBLIC_STYLES else "impact"
    blocks = _blocks_for_style(rs, style)
    bloc = rs.get_bloc_at_with_silence_gate(t, blocks)
    if bloc is None:
        # Hors parole : frame vide (fond seul)
        overlay = np.zeros((FRAME_H, FRAME_W, 4), dtype=np.uint8)
    else:
        active = rs.get_word_at(t, bloc)
        font_path = rs._resolve_font_path(None)
        overlay = rs.render_subtitle_frame(
            FRAME_W, FRAME_H, bloc, active, style, font_path, layout_mode="normal"
        )

    # Fond opaque zinc + overlay RGBA
    bg = np.zeros((FRAME_H, FRAME_W, 3), dtype=np.uint8)
    bg[:] = (24, 24, 27)  # zinc-900-ish
    # Léger vignette / gradient vertical (simple)
    yy = np.linspace(0, 1, FRAME_H, dtype=np.float32)[:, None]
    lift = (18 * (1.0 - yy)).astype(np.uint8)
    bg[:, :, 0] = np.clip(bg[:, :, 0].astype(np.int16) + lift, 0, 255).astype(np.uint8)
    bg[:, :, 1] = np.clip(bg[:, :, 1].astype(np.int16) + lift, 0, 255).astype(np.uint8)
    bg[:, :, 2] = np.clip(bg[:, :, 2].astype(np.int16) + lift, 0, 255).astype(np.uint8)

    alpha = overlay[:, :, 3:4].astype(np.float32) / 255.0
    rgb = overlay[:, :, :3].astype(np.float32)
    composed = (rgb * alpha + bg.astype(np.float32) * (1.0 - alpha)).astype(np.uint8)

    img = Image.fromarray(composed, mode="RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


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

        if path == "/api/meta":
            rs = _load_module()
            self._send_json(200, _meta(rs))
            return

        if path == "/api/reload":
            rs = _load_module(force=True)
            self._send_json(200, {"ok": True, "meta": _meta(rs)})
            return

        if path == "/frame.png":
            style = (qs.get("style") or ["impact"])[0]
            try:
                t = float((qs.get("t") or ["0"])[0])
            except ValueError:
                t = 0.0
            try:
                rs = _load_module()
                png = _render_frame(rs, style, t)
            except Exception as exc:  # noqa: BLE001 — surface error to UI
                self._send(500, str(exc).encode("utf-8"), "text/plain; charset=utf-8")
                return
            self._send(200, png, "image/png")
            return

        self._send(404, b"not found", "text/plain")

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/api/reload":
            rs = _load_module(force=True)
            self._send_json(200, {"ok": True, "meta": _meta(rs)})
            return
        self._send(404, b"not found", "text/plain")


def main() -> None:
    print("Chargement de render_subtitles (Pillow / MediaPipe)…", flush=True)
    _load_module()
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    url = f"http://{HOST}:{PORT}/"
    print(f"Preview sous-titres → {url}", flush=True)
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
