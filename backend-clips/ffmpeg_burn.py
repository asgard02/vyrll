"""Native ffmpeg pass 2: crop + ASS subtitles + encode (no Pillow frame pipe)."""

from __future__ import annotations

import os
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any

import numpy as np


def resolve_render_engine() -> str:
    raw = (os.environ.get("RENDER_ENGINE") or "ffmpeg").strip().lower()
    if raw in ("pillow", "python", "pipe"):
        return "pillow"
    return "ffmpeg"


def even_int(v: float | int) -> int:
    n = int(round(float(v)))
    if n < 2:
        return 2
    return n - (n % 2)


def ass_timestamp(t: float) -> str:
    t = max(0.0, float(t))
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = int(t % 60)
    cs = int(round((t - int(t)) * 100))
    if cs >= 100:
        s += 1
        cs = 0
    if s >= 60:
        m += 1
        s -= 60
    if m >= 60:
        h += 1
        m -= 60
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def hex_to_ass(hex_color: str, alpha: str = "00") -> str:
    h = (hex_color or "#FFFFFF").lstrip("#")
    if len(h) < 6:
        h = "FFFFFF"
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"&H{alpha}{b}{g}{r}"


def _ass_escape(text: str) -> str:
    return (
        (text or "")
        .replace("\\", r"\\")
        .replace("{", r"(")
        .replace("}", r")")
        .replace("\n", r"\N")
    )


def _font_family_from_path(font_path: str) -> str:
    name = Path(font_path).stem.lower()
    if "anton" in name:
        return "Anton"
    if "montserrat" in name:
        return "Montserrat Black"
    return Path(font_path).stem.replace("-", " ")


def _filter_path(p: str) -> str:
    s = os.path.abspath(p).replace("\\", "/")
    return s.replace(":", r"\:").replace("'", r"\'")


def concat_file_line(path: str) -> str:
    """One concat-demuxer line. Double-quoted json paths are treated as the filename."""
    escaped = os.path.abspath(path).replace("\\", "/").replace("'", r"'\''")
    return f"file '{escaped}'\n"


def mono_crop_rect(
    src_w: int,
    src_h: int,
    out_w: int,
    out_h: int,
    cx: float,
    cy: float,
    zoom: float,
    eye_y: float = 0.36,
) -> tuple[int, int, int, int]:
    """Source crop (x, y, w, h) matching talk `resize_and_crop_frame`."""
    src_w = max(2, int(src_w))
    src_h = max(2, int(src_h))
    out_w = max(2, int(out_w))
    out_h = max(2, int(out_h))
    ar_src = src_w / src_h
    ar_out = out_w / out_h
    zoom = float(max(1.0, min(1.45, zoom or 1.0)))
    if ar_src > ar_out:
        scale = (out_h / src_h) * zoom
    else:
        scale = (out_w / src_w) * zoom
    crop_w = min(float(src_w), out_w / scale)
    crop_h = min(float(src_h), out_h / scale)
    x = float(cx) * src_w - crop_w / 2.0
    y = float(cy) * src_h - crop_h * float(max(0.28, min(0.50, eye_y)))
    x = max(0.0, min(x, src_w - crop_w))
    y = max(0.0, min(y, src_h - crop_h))
    w = even_int(crop_w)
    h = even_int(crop_h)
    xi = even_int(x)
    yi = even_int(y)
    if xi + w > src_w:
        xi = max(0, src_w - w)
        xi -= xi % 2
    if yi + h > src_h:
        yi = max(0, src_h - h)
        yi -= yi % 2
    return xi, yi, min(w, src_w), min(h, src_h)


def mask_runs(mask: np.ndarray | None, out_fps: float, min_run_sec: float = 0.35) -> list[tuple[float, float, bool]]:
    """[(start_sec, end_sec, is_split), ...] on clip-relative time."""
    fps = max(1.0, float(out_fps))
    if mask is None or len(mask) == 0:
        return []
    flags = [bool(v) for v in mask]
    n = len(flags)
    raw: list[tuple[int, int, bool]] = []
    i = 0
    while i < n:
        v = flags[i]
        j = i + 1
        while j < n and flags[j] == v:
            j += 1
        raw.append((i, j, v))
        i = j
    min_frames = max(1, int(round(min_run_sec * fps)))
    merged: list[tuple[int, int, bool]] = []
    for a, b, v in raw:
        if merged and (b - a) < min_frames:
            pa, pb, _pv = merged[-1]
            merged[-1] = (pa, b, merged[-1][2])
        elif merged and v == merged[-1][2]:
            pa, _pb, pv = merged[-1]
            merged[-1] = (pa, b, pv)
        else:
            merged.append((a, b, v))
    # Leading micro-run (1–3 frames of mono before split) → absorb into the next run.
    if len(merged) >= 2:
        a0, b0, _v0 = merged[0]
        if (b0 - a0) < min_frames:
            _a1, b1, v1 = merged[1]
            merged[:2] = [(a0, b1, v1)]
    if len(merged) > 8:
        split_n = sum(1 for _a, _b, v in merged if v)
        majority = split_n * 2 >= len(merged)
        return [(0.0, n / fps, majority)]
    return [(a / fps, b / fps, v) for a, b, v in merged]


def _sample_track(
    cx: np.ndarray | None,
    cy: np.ndarray | None,
    zoom: np.ndarray | None,
    src_idx: int,
    default_zoom: float,
) -> tuple[float, float, float]:
    if cx is None or cy is None or len(cx) == 0:
        return 0.5, 0.36, default_zoom
    i = int(max(0, min(src_idx, len(cx) - 1)))
    z = default_zoom
    if zoom is not None and i < len(zoom):
        z = float(zoom[i])
    return float(cx[i]), float(cy[i]), z


def shift_blocks(blocks: list, offset: float, duration: float) -> list:
    """Clip-relative blocks → run-relative [0, duration]."""
    out: list = []
    off = float(offset)
    dur = float(duration)
    for bloc in blocks or []:
        words_out: list = []
        for w in bloc.get("words") or []:
            ws = float(w.get("start", 0) or 0) - off
            we = float(w.get("end", 0) or 0) - off
            if we <= 0.0 or ws >= dur:
                continue
            words_out.append({**w, "start": max(0.0, ws), "end": min(dur, we)})
        if not words_out:
            continue
        b0 = max(0.0, float(bloc.get("bloc_start", 0) or 0) - off)
        b1 = min(dur, float(bloc.get("bloc_end", 0) or 0) - off)
        if b1 <= b0:
            continue
        out.append({**bloc, "bloc_start": b0, "bloc_end": b1, "words": words_out})
    return out


def build_sendcmd(
    duration: float,
    src_w: int,
    src_h: int,
    out_w: int,
    out_h: int,
    cx: np.ndarray | None,
    cy: np.ndarray | None,
    zoom: np.ndarray | None,
    fps_src: float,
    default_zoom: float,
    eye_y: float,
    hop: float = 0.25,
    track_offset: float = 0.0,
) -> str:
    lines: list[str] = []
    t = 0.0
    last = None
    while t <= duration + 1e-6:
        src_idx = int(round((t + float(track_offset)) * max(fps_src, 1.0)))
        ccx, ccy, zz = _sample_track(cx, cy, zoom, src_idx, default_zoom)
        rect = mono_crop_rect(src_w, src_h, out_w, out_h, ccx, ccy, zz, eye_y)
        if rect != last:
            x, y, w, h = rect
            lines.append(
                f"{t:.3f} crop w {w}, crop h {h}, crop x {x}, crop y {y};"
            )
            last = rect
        t += hop
    if not lines:
        x, y, w, h = mono_crop_rect(src_w, src_h, out_w, out_h, 0.5, 0.36, default_zoom, eye_y)
        lines.append(f"0.0 crop w {w}, crop h {h}, crop x {x}, crop y {y};")
    return "\n".join(lines) + "\n"


def caption_layout_for_run(is_split: bool) -> str:
    """Hybrid clips: only stacked segments use split ASS (80px / top). Mono stays 96px / bottom."""
    return "split_vertical" if is_split else "normal"


# Pillow primary sizes @ 1080 (mono, split). Used for layout / MarginV.
_ASS_FONTSIZE = {
    "impact": (132, 96),
    "karaoke": (96, 80),
    "ocean": (96, 80),
    "berry": (96, 80),
    "boxed": (96, 80),
    "highlight": (96, 80),
    "neon": (92, 80),
    "sunset": (96, 80),
    "minimal": (78, 72),
    "slate": (78, 72),
}


def ass_layout_fontsize(style: str, layout_mode: str, out_w: int = 1080) -> int:
    """Pillow / lab size. PlayRes 1080 → Fontsize is pixels; do not inflate Impact."""
    split = layout_mode in ("split_vertical", "stream_stack")
    mono_fs, split_fs = _ASS_FONTSIZE.get((style or "").strip().lower(), (96, 80))
    base_fs = split_fs if split else mono_fs
    return max(48, int(round(base_fs * (out_w / 1080.0))))


def ass_fontsize_for_style(style: str, layout_mode: str, out_w: int = 1080) -> int:
    return ass_layout_fontsize(style, layout_mode, out_w)


def ass_side_margin(style: str, out_w: int = 1080) -> int:
    if (style or "").strip().lower() == "impact":
        import render_subtitles as rs

        margin_x, _budget = rs.impact_fit_budget(out_w)
        return max(40, int(margin_x))
    return 40


def ass_impact_fontsize(layout_mode: str, out_w: int = 1080) -> int:
    return ass_fontsize_for_style("impact", layout_mode, out_w)


def ass_karaoke_fontsize(layout_mode: str, out_w: int = 1080) -> int:
    return ass_fontsize_for_style("karaoke", layout_mode, out_w)


def ass_split_margin_v(out_h: int, fontsize: int, outline_w: int, max_lines: int = 2) -> int:
    """Alignment 8 MarginV: keep the whole caption block above the 60/40 seam.

    `SPLIT_TOP_H - fontsize` put the *top* of the glyphs just above the join, so
    the letters themselves straddled the two panels and looked sliced.
    """
    import render_subtitles as rs

    seam = int(round(out_h * (rs.SPLIT_TOP_H / 1920.0)))
    line_h = max(fontsize + 8, int(round(fontsize * 1.28)))
    block_h = max(1, max_lines) * line_h + max(0, outline_w)
    pad = max(12, int(round(out_h * 0.012)))
    return max(24, seam - block_h - pad)


def _ass_impact_event_text(
    lines: list[list[dict]],
    active_word: dict | None,
    fontsize: int,
    active: str,
    inactive: str,
) -> str:
    """Pillow wrap + fitted \\fs. \\blur softens libass's hard outline vs the lab."""
    line_strs: list[str] = []
    for line in lines:
        segs: list[str] = []
        for ow in line:
            tok = _ass_escape(str(ow.get("word") or ""))
            if not tok:
                continue
            if active_word is not None and ow is active_word:
                segs.append(
                    f"{{\\fscx114\\fscy114\\c{active}}}{tok}"
                    f"{{\\fscx100\\fscy100\\c{inactive}}}"
                )
            else:
                segs.append(tok)
        if segs:
            line_strs.append(" ".join(segs))
    body = r"\N".join(line_strs)
    return f"{{\\fs{int(fontsize)}\\blur0.5}}{body}"


def generate_ass(
    blocks: list,
    duration: float,
    out_w: int,
    out_h: int,
    style: str,
    font_path: str,
    hook_text: str | None = None,
    hook_duration: float = 3.0,
    layout_mode: str = "normal",
    colors: dict | None = None,
) -> str:
    import render_subtitles as rs

    colors = colors or rs.STYLE_COLORS.get(style, rs.STYLE_COLORS["karaoke"])
    active = hex_to_ass(colors.get("active", "#FFD700"))
    inactive = hex_to_ass(colors.get("inactive", "#FFFFFF"))
    outline = hex_to_ass(colors.get("contour", "#000000"))
    resolved_font = rs._resolve_font_path(font_path)
    family = _font_family_from_path(resolved_font)
    variant = rs.STYLE_VARIANTS.get(style, "pill")
    karaoke = variant not in ("minimal",)
    layout_fs = ass_layout_fontsize(style, layout_mode, out_w)
    fontsize = ass_fontsize_for_style(style, layout_mode, out_w)
    outline_w = 10 if variant == "impact" else 8
    wrap_style = "2" if variant == "impact" else "0"
    side_m = ass_side_margin(style, out_w)
    # Impact is already Montserrat Black — fake Bold fattens glyphs past the lab.
    bold = 0 if variant == "impact" else -1
    if layout_mode in ("split_vertical", "stream_stack"):
        align = 8
        if layout_mode == "split_vertical":
            margin_v = ass_split_margin_v(out_h, layout_fs, outline_w)
        else:
            margin_v = max(40, int(round(out_h * (rs.STREAM_STACK_SEAM_Y / 1920.0) - layout_fs)))
        margin_v = max(24, min(margin_v, out_h - 80))
    else:
        align = 2
        margin_v = max(48, int(round(out_h * (1.0 - rs.SAFE_BOTTOM_RATIO))))

    header = (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        f"PlayResX: {out_w}\n"
        f"PlayResY: {out_h}\n"
        f"WrapStyle: {wrap_style}\n"
        "ScaledBorderAndShadow: yes\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
        "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, "
        "ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
        "Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"Style: Default,{family},{fontsize},{inactive},{inactive},{outline},"
        f"&H80000000,{bold},0,0,0,100,100,0,0,1,{outline_w},2,{align},"
        f"{side_m},{side_m},{margin_v},1\n"
        f"Style: Hook,{family},{max(48, int(fontsize * 0.9))},&H00000000,&H00000000,"
        f"&H00FFFFFF,&H00FFFFFF,-1,0,0,0,100,100,0,0,3,10,0,8,40,40,"
        f"{max(80, int(out_h * 0.12))},1\n\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )
    events: list[str] = []
    hook = (hook_text or "").strip()
    if hook:
        hd = max(0.4, float(hook_duration or 3.0))
        events.append(
            f"Dialogue: 1,0:00:00.00,{ass_timestamp(hd)},Hook,,0,0,0,,"
            f"{_ass_escape(hook)}"
        )

    for bloc in blocks or []:
        words = list(bloc.get("words") or [])
        if not words:
            continue
        b0 = float(bloc.get("bloc_start", 0) or 0)
        b1 = min(float(bloc.get("bloc_end", b0) or b0), duration)
        if b1 <= b0:
            continue
        if not karaoke:
            text = _ass_escape(" ".join(str(w.get("word") or "") for w in words))
            events.append(
                f"Dialogue: 0,{ass_timestamp(b0)},{ass_timestamp(b1)},Default,,0,0,0,,{text}"
            )
            continue
        impact_fs = fontsize
        impact_lines: list[list[dict]] | None = None
        if variant == "impact":
            impact_fs, impact_lines, _, _ = rs.impact_fit_layout(
                out_w, words, layout_mode, resolved_font
            )
        for i, w in enumerate(words):
            ws = max(b0, float(w.get("start", b0) or b0))
            we = min(b1, float(w.get("end", ws) or ws))
            if i + 1 < len(words):
                nxt = float(words[i + 1].get("start", we) or we)
                we = min(b1, max(we, min(nxt, we + 0.08)))
            else:
                we = b1
            if we <= ws:
                continue
            if variant == "impact" and impact_lines is not None:
                text = _ass_impact_event_text(
                    impact_lines, w, impact_fs, active, inactive
                )
                events.append(
                    f"Dialogue: 0,{ass_timestamp(ws)},{ass_timestamp(we)},Default,,0,0,0,,"
                    f"{text}"
                )
                continue
            parts: list[str] = []
            for j, ow in enumerate(words):
                tok = _ass_escape(str(ow.get("word") or ""))
                if not tok:
                    continue
                if j == i:
                    parts.append(f"{{\\c{active}}}{tok}{{\\c{inactive}}}")
                else:
                    parts.append(tok)
            events.append(
                f"Dialogue: 0,{ass_timestamp(ws)},{ass_timestamp(we)},Default,,0,0,0,,"
                f"{' '.join(parts)}"
            )
    return header + "\n".join(events) + "\n"


def _x264_args() -> tuple[str, str, str]:
    preset = (os.environ.get("RENDER_LIBX264_PRESET") or "veryfast").strip() or "veryfast"
    crf = (os.environ.get("RENDER_LIBX264_CRF") or "20").strip() or "20"
    threads = (os.environ.get("RENDER_LIBX264_THREADS") or "6").strip() or "6"
    return preset, crf, threads


def _audio_bitrate() -> str:
    return (os.environ.get("RENDER_AUDIO_BITRATE") or "192k").strip() or "192k"


def _ffmpeg_timeout_sec(cmd: list[str]) -> float:
    """Kill hung encodes. 8× realtime + 45s, 45s floor, 8 min cap. Concat (no -t) = 2 min."""
    dur = None
    for i, tok in enumerate(cmd):
        if tok == "-t" and i + 1 < len(cmd):
            try:
                dur = max(0.05, float(cmd[i + 1]))
            except ValueError:
                dur = None
            break
    if dur is None:
        return 120.0
    return min(480.0, max(45.0, dur * 8.0 + 45.0))


def _run_ffmpeg(cmd: list[str], label: str) -> None:
    if cmd and cmd[0] == "ffmpeg" and "-nostdin" not in cmd:
        cmd = [cmd[0], "-nostdin", *cmd[1:]]
    timeout = _ffmpeg_timeout_sec(cmd)
    print("FFMPEG_CMD:", " ".join(cmd), f"timeout={timeout:.0f}s", flush=True)
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            stdin=subprocess.DEVNULL,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        err = (exc.stderr or b"").decode("utf-8", errors="replace")
        print("FFMPEG_STDERR:", err[-4000:], flush=True)
        raise RuntimeError(f"{label} ffmpeg timeout after {timeout:.0f}s: {err[-1500:]}") from exc
    err = (proc.stderr or b"").decode("utf-8", errors="replace")
    print("FFMPEG_STDERR:", err[-4000:], flush=True)
    if proc.returncode != 0:
        raise RuntimeError(f"{label} ffmpeg exit {proc.returncode}: {err[-1500:]}")


def _output_codec_args(r_fps: str) -> list[str]:
    preset, crf, threads = _x264_args()
    return [
        "-c:v", "libx264", "-preset", preset, "-crf", crf,
        "-pix_fmt", "yuv420p", "-threads", threads, "-r", r_fps,
        "-c:a", "aac", "-b:a", _audio_bitrate(),
        "-ar", "48000", "-ac", "2", "-profile:a", "aac_low",
        "-shortest", "-movflags", "+faststart",
    ]


def build_ffmpeg_encode_cmd(
    video_path: str,
    start: float,
    duration: float,
    output_path: str,
    filter_complex: str,
    map_v: str,
    extra_inputs: list[str] | None = None,
    clean_output: str | None = None,
    clean_map: str | None = None,
    out_fps: float = 24.0,
) -> list[str]:
    """One ffmpeg: -ss/-t on the video input, then extras, then vout (+ clean)."""
    r_fps = f"{out_fps:.3f}".rstrip("0").rstrip(".")
    extra = list(extra_inputs or [])
    codec = _output_codec_args(r_fps)
    ss = max(0.0, float(start))
    dur = max(0.05, float(duration))
    cmd = [
        "ffmpeg", "-y", "-nostdin", "-hide_banner",
        "-ss", f"{ss:.3f}", "-t", f"{dur:.3f}",
        "-i", video_path,
        *extra,
        "-filter_complex", filter_complex,
        "-map", map_v, "-map", "0:a:0?",
        *codec,
        output_path,
    ]
    if clean_output and clean_map:
        cmd.extend([
            "-map", clean_map, "-map", "0:a:0?",
            *codec,
            clean_output,
        ])
    return cmd


def _encode_filter(
    video_path: str,
    start: float,
    duration: float,
    output_path: str,
    filter_complex: str,
    map_v: str,
    extra_inputs: list[str] | None = None,
    clean_output: str | None = None,
    clean_map: str | None = None,
    out_fps: float = 24.0,
) -> None:
    want_clean = bool(clean_output and clean_map)
    cmd = build_ffmpeg_encode_cmd(
        video_path,
        start,
        duration,
        output_path,
        filter_complex,
        map_v,
        extra_inputs=extra_inputs,
        clean_output=clean_output if want_clean else None,
        clean_map=clean_map if want_clean else None,
        out_fps=out_fps,
    )
    _run_ffmpeg(cmd, "main+clean" if want_clean else "main")


def _subs_filter(ass_path: str, fonts_dir: str) -> str:
    return f"subtitles='{_filter_path(ass_path)}':fontsdir='{_filter_path(fonts_dir)}'"


_HAS_SUBTITLES_FILTER: bool | None = None


def ffmpeg_has_subtitles_filter() -> bool:
    global _HAS_SUBTITLES_FILTER
    if _HAS_SUBTITLES_FILTER is None:
        proc = subprocess.run(
            ["ffmpeg", "-hide_banner", "-filters"],
            capture_output=True,
            text=True,
        )
        blob = f"{proc.stdout or ''}{proc.stderr or ''}"
        _HAS_SUBTITLES_FILTER = (
            " subtitles " in blob
            or "\nsubtitles " in blob
            or "\nass " in blob
            or " ass " in blob
        )
        print(
            f"[CAPTIONS] ffmpeg libass/subtitles="
            f"{'yes' if _HAS_SUBTITLES_FILTER else 'no'}",
            flush=True,
        )
    return bool(_HAS_SUBTITLES_FILTER)


def _word_spans(blocks: list, duration: float, karaoke: bool) -> list[tuple[float, float, dict, dict | None]]:
    spans: list[tuple[float, float, dict, dict | None]] = []
    for bloc in blocks or []:
        words = list(bloc.get("words") or [])
        if not words:
            continue
        b0 = float(bloc.get("bloc_start", 0) or 0)
        b1 = min(float(bloc.get("bloc_end", b0) or b0), duration)
        if b1 <= b0:
            continue
        if not karaoke:
            spans.append((b0, b1, bloc, None))
            continue
        for i, w in enumerate(words):
            ws = max(b0, float(w.get("start", b0) or b0))
            we = min(b1, float(w.get("end", ws) or ws))
            if i + 1 < len(words):
                nxt = float(words[i + 1].get("start", we) or we)
                we = min(b1, max(we, min(nxt, we + 0.08)))
            else:
                we = b1
            if we > ws:
                spans.append((ws, we, bloc, w))
    return spans


def build_png_overlay_inputs(
    tmp: str,
    blocks: list,
    duration: float,
    out_w: int,
    out_h: int,
    style: str,
    font_path: str,
    hook_text: str | None,
    hook_duration: float,
    layout_mode: str,
) -> tuple[list[str], str]:
    """Timed Pillow stills → ffmpeg overlay. Used when libass is missing."""
    import render_subtitles as rs
    from PIL import Image

    extra: list[str] = []
    enable_by_idx: dict[int, list[tuple[float, float]]] = {}
    path_to_idx: dict[str, int] = {}
    inp = 1  # 0 is the video

    def _add_png(arr, t0: float, t1: float) -> None:
        nonlocal inp
        if arr is None or t1 <= t0:
            return
        from hashlib import sha1
        digest = sha1(arr.tobytes()).hexdigest()[:16]
        png = os.path.join(tmp, f"ov-{digest}.png")
        if png not in path_to_idx:
            Image.fromarray(arr).save(png)
            extra.extend(["-loop", "1", "-i", png])
            path_to_idx[png] = inp
            inp += 1
        idx = path_to_idx[png]
        enable_by_idx.setdefault(idx, []).append((t0, t1))

    hook = (hook_text or "").strip()
    if hook:
        overlay = rs.render_hook_title_card(out_w, out_h, hook, font_path)
        _add_png(overlay, 0.0, max(0.4, float(hook_duration or 3.0)))

    karaoke = rs.STYLE_VARIANTS.get(style, "pill") not in ("minimal",)
    for t0, t1, bloc, active in _word_spans(blocks, duration, karaoke):
        overlay = rs.render_subtitle_frame(
            out_w, out_h, bloc, active, style, font_path, layout_mode=layout_mode
        )
        _add_png(overlay, t0, t1)

    if not extra:
        return [], ""

    chain = []
    prev = "pre"
    last = "vout"
    keys = sorted(enable_by_idx)
    for i, idx in enumerate(keys):
        ranges = enable_by_idx[idx]
        expr = "+".join(f"between(t,{a:.3f},{b:.3f})" for a, b in ranges)
        out_lab = last if i == len(keys) - 1 else f"ov{i}"
        chain.append(
            f"[{prev}][{idx}:v]overlay=0:0:format=auto:enable='{expr}'[{out_lab}]"
        )
        prev = out_lab
    return extra, ";".join(chain)


def _caption_stage(
    tmp: str,
    *,
    duration: float,
    out_w: int,
    out_h: int,
    style: str,
    font_path: str,
    fonts_dir: str,
    blocks: list,
    hook_text: str | None,
    hook_duration: float,
    layout_mode: str,
    want_clean: bool,
) -> tuple[str, list[str], str, str | None]:
    """From labeled [pre] video → [vout] (+ optional [clean]).

    Karaoke as 100+ PNG overlay inputs freezes ffmpeg (minutes per clip, Next
    times out, player keeps the old R2 object). Without libass, let the caller
    fall back to the Pillow frame pipe.
    """
    import render_subtitles as rs
    from PIL import Image

    hook = (hook_text or "").strip()
    # Always the Pillow TikTok banner. ASS Hook style is plain black text (ugly on camera).
    hook_needs_pillow = bool(hook)
    hook_extra: list[str] = []
    hook_enable = ""
    if hook_needs_pillow:
        overlay = rs.render_hook_title_card(out_w, out_h, hook, font_path)
        if overlay is not None:
            png = os.path.join(tmp, "hook.png")
            Image.fromarray(overlay).save(png)
            hd = max(0.4, float(hook_duration or 3.0))
            hook_extra = ["-loop", "1", "-i", png]
            hook_enable = (
                f"overlay=0:0:format=auto:enable='between(t,0.000,{hd:.3f})'"
            )
            print(f"[HOOK] pillow title card {hd:.1f}s — {hook[:80]!r}", flush=True)

    if ffmpeg_has_subtitles_filter():
        ass_hook = None if hook_extra else hook
        ass_path = os.path.join(tmp, "subs.ass")
        Path(ass_path).write_text(
            generate_ass(
                blocks, duration, out_w, out_h, style, font_path,
                hook_text=ass_hook, hook_duration=hook_duration, layout_mode=layout_mode,
            ),
            encoding="utf-8",
        )
        fontsize = ass_fontsize_for_style(style, layout_mode, out_w)
        layout_fs = ass_layout_fontsize(style, layout_mode, out_w)
        extra = ""
        if layout_mode == "split_vertical":
            outline_w = 10 if (style or "").strip().lower() == "impact" else 8
            mv = ass_split_margin_v(out_h, layout_fs, outline_w)
            extra = f" margin_v={mv} seam={int(round(out_h * (rs.SPLIT_TOP_H / 1920.0)))}"
        print(
            f"[CAPTIONS] style={style} layout_mode={layout_mode} "
            f"fontsize={fontsize} layout_fs={layout_fs} "
            f"dur={duration:.2f}s{extra}",
            flush=True,
        )
        subs = _subs_filter(ass_path, fonts_dir)
        if hook_enable:
            if want_clean:
                graph = (
                    f"[pre]split=2[ps][clean];[ps]{subs}[sc];"
                    f"[sc][1:v]{hook_enable}[vout]"
                )
                return graph, hook_extra, "[vout]", "[clean]"
            graph = f"[pre]{subs}[sc];[sc][1:v]{hook_enable}[vout]"
            return graph, hook_extra, "[vout]", None
        if want_clean:
            return f"[pre]split=2[ps][clean];[ps]{subs}[vout]", [], "[vout]", "[clean]"
        return f"[pre]{subs}[vout]", [], "[vout]", None

    raise RuntimeError(
        "ffmpeg missing libass/subtitles filter — use Pillow frame pipe "
        "(PNG overlay chains of 100+ stills hang the encode)"
    )


def _split_lock_at(
    lock_top: np.ndarray | None,
    lock_bot: np.ndarray | None,
    t: float,
    out_fps: float,
    face_positions: list,
) -> tuple[tuple[float, float], tuple[float, float]]:
    def _from_faces() -> tuple[tuple[float, float], tuple[float, float]]:
        if len(face_positions) >= 2:
            a = (float(face_positions[0].get("cx", 0.35)), float(face_positions[0].get("cy", 0.32)))
            b = (float(face_positions[1].get("cx", 0.65)), float(face_positions[1].get("cy", 0.32)))
            if a[0] <= b[0]:
                return a, b
            return b, a
        return (0.35, 0.32), (0.65, 0.32)

    if lock_top is None or lock_bot is None or len(lock_top) == 0:
        return _from_faces()
    i = int(max(0, min(round(t * out_fps), len(lock_top) - 1)))
    tx, ty = float(lock_top[i, 0]), float(lock_top[i, 1])
    bx, by = float(lock_bot[i, 0]), float(lock_bot[i, 1])
    if not (np.isfinite(tx) and np.isfinite(ty) and np.isfinite(bx) and np.isfinite(by)):
        return _from_faces()
    return (tx, ty), (bx, by)


def render_talk_pass2(
    *,
    video_path: str,
    start: float,
    duration: float,
    output_path: str,
    blocks: list,
    style: str,
    font_path: str,
    out_w: int,
    out_h: int,
    out_fps: float,
    src_w: int,
    src_h: int,
    fps_src: float,
    cx_smooth: np.ndarray | None,
    cy_smooth: np.ndarray | None,
    zoom_smooth: np.ndarray | None,
    layout_split_mask: np.ndarray | None,
    split_lock_top: np.ndarray | None,
    split_lock_bot: np.ndarray | None,
    face_positions: list,
    hook_text: str | None,
    hook_duration: float,
    clean_output: str | None,
    work_dir: str | None = None,
) -> dict[str, Any]:
    import render_subtitles as rs

    t0 = time.monotonic()
    work = work_dir or str(Path(output_path).parent)
    os.makedirs(work, exist_ok=True)
    fonts_dir = str(Path(font_path).parent) if font_path else str(Path(__file__).parent / "fonts")

    runs = mask_runs(layout_split_mask, out_fps)
    if not runs:
        runs = [(0.0, duration, False)]
    else:
        # Clamp to clip duration
        runs = [(max(0.0, a), min(duration, b), v) for a, b, v in runs if b > a + 0.05]
        if not runs:
            runs = [(0.0, duration, False)]

    split_sec = sum((b - a) for a, b, v in runs if v)
    effective_mode = "split_vertical" if (split_sec / max(duration, 0.01)) >= 0.05 else "normal"
    print(
        f"[CLIP-STEP] RENDER pass2 start mode={effective_mode} dur={float(duration):.1f}s runs={len(runs)}",
        flush=True,
    )

    with tempfile.TemporaryDirectory(prefix="ffburn-", dir=work) as tmp:
        default_zoom = float(rs.MONO_FACE_ZOOM)

        if effective_mode != "split_vertical" or all(not v for _a, _b, v in runs):
            cap_f, extra, map_v, clean_map = _caption_stage(
                tmp,
                duration=duration,
                out_w=out_w,
                out_h=out_h,
                style=style,
                font_path=font_path,
                fonts_dir=fonts_dir,
                blocks=blocks,
                hook_text=hook_text,
                hook_duration=hook_duration,
                layout_mode="normal",
                want_clean=bool(clean_output),
            )
            cmd_path = os.path.join(tmp, "crop.txt")
            Path(cmd_path).write_text(
                build_sendcmd(
                    duration, src_w, src_h, out_w, out_h,
                    cx_smooth, cy_smooth, zoom_smooth, fps_src,
                    default_zoom, rs.MONO_EYE_Y_IN_FRAME,
                ),
                encoding="utf-8",
            )
            x0, y0, w0, h0 = mono_crop_rect(
                src_w, src_h, out_w, out_h, 0.5, 0.36, default_zoom, rs.MONO_EYE_Y_IN_FRAME
            )
            vf = (
                f"[0:v]setpts=PTS-STARTPTS,fps={out_fps:.3f},"
                f"sendcmd=f='{_filter_path(cmd_path)}',"
                f"crop={w0}:{h0}:{x0}:{y0},scale={out_w}:{out_h}:flags=lanczos,"
                f"format=yuv420p[pre];{cap_f}"
            )
            _encode_filter(
                video_path, start, duration, output_path, vf, map_v,
                extra_inputs=extra,
                clean_output=clean_output, clean_map=clean_map,
                out_fps=out_fps,
            )
        else:
            parts: list[str] = []
            for i, (a, b, is_split) in enumerate(runs):
                part = os.path.join(tmp, f"run-{i}.mp4")
                dur = max(0.08, b - a)
                abs_start = start + a
                cap_dir = os.path.join(tmp, f"cap-{i}")
                os.makedirs(cap_dir, exist_ok=True)
                run_blocks = shift_blocks(blocks, a, dur)
                run_layout = caption_layout_for_run(is_split)
                print(
                    f"[CAPTIONS] run={i} is_split={int(is_split)} layout_mode={run_layout} dur={dur:.2f}s",
                    flush=True,
                )
                run_cap, run_extra, run_map, _cm = _caption_stage(
                    cap_dir,
                    duration=dur,
                    out_w=out_w,
                    out_h=out_h,
                    style=style,
                    font_path=font_path,
                    fonts_dir=fonts_dir,
                    blocks=run_blocks,
                    hook_text=hook_text if i == 0 else None,
                    hook_duration=hook_duration,
                    layout_mode=run_layout,
                    want_clean=False,
                )
                if is_split:
                    (tx, ty), (bx, by) = _split_lock_at(
                        split_lock_top, split_lock_bot, (a + b) / 2.0, out_fps, face_positions
                    )
                    scale = out_h / 1920.0 if out_h else 1.0
                    top_h = even_int(rs.SPLIT_TOP_H * scale)
                    bot_h = even_int(out_h - top_h)
                    zt = float(rs.split_shared_zoom(tx, bx))
                    x1, y1, w1, h1 = mono_crop_rect(src_w, src_h, out_w, top_h, tx, ty, zt, 0.36)
                    x2, y2, w2, h2 = mono_crop_rect(src_w, src_h, out_w, bot_h, bx, by, zt, 0.40)
                    vf = (
                        f"[0:v]setpts=PTS-STARTPTS,fps={out_fps:.3f},split=2[a][b];"
                        f"[a]crop={w1}:{h1}:{x1}:{y1},scale={out_w}:{top_h}:flags=lanczos[top];"
                        f"[b]crop={w2}:{h2}:{x2}:{y2},scale={out_w}:{bot_h}:flags=lanczos[bot];"
                        f"[top][bot]vstack=inputs=2,format=yuv420p[pre];{run_cap}"
                    )
                else:
                    cmd_path = os.path.join(tmp, f"crop-{i}.txt")
                    Path(cmd_path).write_text(
                        build_sendcmd(
                            dur, src_w, src_h, out_w, out_h,
                            cx_smooth, cy_smooth, zoom_smooth, fps_src,
                            default_zoom, rs.MONO_EYE_Y_IN_FRAME,
                            track_offset=a,
                        ),
                        encoding="utf-8",
                    )
                    x0, y0, w0, h0 = mono_crop_rect(
                        src_w, src_h, out_w, out_h, 0.5, 0.36, default_zoom, rs.MONO_EYE_Y_IN_FRAME
                    )
                    vf = (
                        f"[0:v]setpts=PTS-STARTPTS,fps={out_fps:.3f},"
                        f"sendcmd=f='{_filter_path(cmd_path)}',"
                        f"crop={w0}:{h0}:{x0}:{y0},scale={out_w}:{out_h}:flags=lanczos,"
                        f"format=yuv420p[pre];{run_cap}"
                    )
                _encode_filter(
                    video_path, abs_start, dur, part, vf, run_map,
                    extra_inputs=run_extra, out_fps=out_fps,
                )
                parts.append(part)
            concat_list = os.path.join(tmp, "concat.txt")
            Path(concat_list).write_text(
                "".join(concat_file_line(p) for p in parts),
                encoding="utf-8",
            )
            _run_ffmpeg(
                [
                    "ffmpeg", "-y", "-nostdin", "-hide_banner", "-f", "concat", "-safe", "0",
                    "-i", concat_list, "-c", "copy", output_path,
                ],
                "concat",
            )
            if clean_output:
                try:
                    import shutil
                    shutil.copyfile(output_path, clean_output)
                except OSError:
                    pass

    elapsed = time.monotonic() - t0
    print(
        f"[CLIP-STEP] RENDER pass2 ok {elapsed:.1f}s mode={effective_mode}",
        flush=True,
    )
    print(
        f"[TIMING] pass2 (ffmpeg-native) {elapsed:.1f}s engine=ffmpeg mode={effective_mode}",
        flush=True,
    )
    total_frames = max(1, int(round(duration * out_fps)))
    split_frames = int(round(split_sec * out_fps)) if effective_mode == "split_vertical" else 0
    return {
        "effective_mode": effective_mode,
        "split_frames": split_frames,
        "total_frames": total_frames,
        "split_ratio": split_frames / total_frames,
    }


def _facecam_crop_rect(
    facecam: dict | None,
    src_w: int,
    src_h: int,
    panel_w: int,
    panel_h: int,
) -> tuple[int, int, int, int]:
    import stream_layout as sl

    if not facecam:
        return sl._cover_crop_rect(src_w, src_h, panel_w, panel_h, 0.5, 0.34)
    pip = sl._pip_pixel_box(facecam, src_w, src_h)
    fx, fy, fw, fh = pip
    face_cx = facecam.get("face_cx")
    face_cy = facecam.get("face_cy")
    if face_cx is None or face_cy is None:
        return fx, fy, even_int(fw), even_int(fh)
    ar = panel_w / float(panel_h)
    face_px = float(np.clip(float(face_cx) * src_w, fx + 4, fx + fw - 4))
    face_py = float(np.clip(float(face_cy) * src_h, fy + 4, fy + fh - 4))
    ch = min(fh, max(32, int(round(fh / max(1.0, float(sl.FACE_TOP_ZOOM))))))
    cw = max(32, int(round(ch * ar)))
    if cw > fw:
        cw = fw
        ch = max(32, min(fh, int(round(cw / ar))))
    cw, ch = even_int(cw), even_int(ch)
    x0 = int(np.clip(face_px - cw / 2.0, fx, fx + fw - cw))
    y0 = int(np.clip(face_py - sl.FACE_ANCHOR_Y * ch, fy, fy + fh - ch))
    x0 -= x0 % 2
    y0 -= y0 % 2
    return x0, y0, min(cw, fw), min(ch, fh)


def render_stream_pass2(
    *,
    video_path: str,
    start: float,
    duration: float,
    output_path: str,
    blocks: list,
    style: str,
    font_path: str,
    out_w: int,
    out_h: int,
    out_fps: float,
    src_w: int,
    src_h: int,
    layout: str,
    facecam: dict | None,
    mono_face: dict | None,
    game_rect: tuple[int, int, int, int] | None,
    hook_text: str | None,
    hook_duration: float,
    clean_output: str | None,
    work_dir: str | None = None,
) -> dict[str, Any]:
    import stream_layout as sl

    t0 = time.monotonic()
    print(
        f"[CLIP-STEP] RENDER stream start dur={float(duration):.1f}s layout={layout}",
        flush=True,
    )
    work = work_dir or str(Path(output_path).parent)
    fonts_dir = str(Path(font_path).parent) if font_path else str(Path(__file__).parent / "fonts")
    top_h = even_int(sl.STREAM_TOP_H * (out_h / float(sl.OUT_H)))
    bottom_h = even_int(out_h - top_h)

    with tempfile.TemporaryDirectory(prefix="ffstream-", dir=work) as tmp:
        layout_mode = "stream_stack" if layout == "stack" and facecam is not None else "normal"
        cap_f, extra, map_v, clean_map = _caption_stage(
            tmp,
            duration=duration,
            out_w=out_w,
            out_h=out_h,
            style=style,
            font_path=font_path,
            fonts_dir=fonts_dir,
            blocks=blocks,
            hook_text=hook_text,
            hook_duration=hook_duration,
            layout_mode=layout_mode,
            want_clean=bool(clean_output),
        )
        if layout == "mono" and mono_face is not None:
            cx = float(mono_face.get("face_cx", 0.5))
            cy = float(mono_face.get("face_cy", 0.45))
            x, y, w, h = mono_crop_rect(src_w, src_h, out_w, out_h, cx, cy, 1.12, 0.34)
            base = (
                f"[0:v]setpts=PTS-STARTPTS,fps={out_fps:.3f},"
                f"crop={w}:{h}:{x}:{y},scale={out_w}:{out_h}:flags=lanczos,format=yuv420p[pre]"
            )
        elif facecam is not None:
            cx0, cy0, cw, ch = _facecam_crop_rect(facecam, src_w, src_h, out_w, top_h)
            if game_rect is None:
                gx, gy, gw, gh = sl.gameplay_crop_rect(src_w, src_h, facecam, out_w, bottom_h)
            else:
                gx, gy, gw, gh = game_rect
            gx, gy, gw, gh = even_int(gx), even_int(gy), even_int(gw), even_int(gh)
            base = (
                f"[0:v]setpts=PTS-STARTPTS,fps={out_fps:.3f},split=2[cam][game];"
                f"[cam]crop={cw}:{ch}:{cx0}:{cy0},scale={out_w}:{top_h}:flags=lanczos[top];"
                f"[game]crop={gw}:{gh}:{gx}:{gy},scale={out_w}:{bottom_h}:flags=lanczos[bot];"
                f"[top][bot]vstack=inputs=2,format=yuv420p[pre]"
            )
        else:
            x, y, w, h = sl._cover_crop_rect(src_w, src_h, out_w, out_h, 0.5, 0.45)
            x, y, w, h = even_int(x), even_int(y), even_int(w), even_int(h)
            base = (
                f"[0:v]setpts=PTS-STARTPTS,fps={out_fps:.3f},"
                f"crop={w}:{h}:{x}:{y},scale={out_w}:{out_h}:flags=lanczos,format=yuv420p[pre]"
            )
        _encode_filter(
            video_path, start, duration, output_path, f"{base};{cap_f}", map_v,
            extra_inputs=extra,
            clean_output=clean_output, clean_map=clean_map,
            out_fps=out_fps,
        )

    elapsed = time.monotonic() - t0
    print(f"[CLIP-STEP] RENDER stream ok {elapsed:.1f}s", flush=True)
    print(f"[TIMING] stream render {elapsed:.1f}s engine=ffmpeg", flush=True)
    print(
        "[LAYOUT] effective_mode=stream_stack split_frames=0/1 ratio=0.000 gated_split=0",
        flush=True,
    )
    return {"effective_mode": "stream_stack", "split_frames": 0, "total_frames": 1, "split_ratio": 0.0}


def render_reburn_pass2(
    *,
    video_path: str,
    duration: float,
    output_path: str,
    blocks: list,
    style: str,
    font_path: str,
    out_w: int,
    out_h: int,
    out_fps: float,
    hook_text: str | None,
    hook_duration: float,
) -> None:
    t0 = time.monotonic()
    work = str(Path(output_path).parent)
    fonts_dir = str(Path(font_path).parent) if font_path else str(Path(__file__).parent / "fonts")
    with tempfile.TemporaryDirectory(prefix="ffreburn-", dir=work) as tmp:
        cap_f, extra, map_v, _cm = _caption_stage(
            tmp,
            duration=duration,
            out_w=out_w,
            out_h=out_h,
            style=style,
            font_path=font_path,
            fonts_dir=fonts_dir,
            blocks=blocks,
            hook_text=hook_text,
            hook_duration=hook_duration,
            layout_mode="normal",
            want_clean=False,
        )
        vf = (
            f"[0:v]setpts=PTS-STARTPTS,fps={out_fps:.3f},"
            f"scale={out_w}:{out_h}:force_original_aspect_ratio=increase:flags=lanczos,"
            f"crop={out_w}:{out_h},format=yuv420p[pre];{cap_f}"
        )
        _encode_filter(
            video_path, 0.0, duration, output_path, vf, map_v,
            extra_inputs=extra, out_fps=out_fps,
        )
    print(f"[BASE-VIDEO] DONE in {time.monotonic() - t0:.1f}s engine=ffmpeg", flush=True)
