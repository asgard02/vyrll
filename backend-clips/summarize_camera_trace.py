#!/usr/bin/env python3
"""Summarize a camera JSONL trace by output range. This script only reads."""

from __future__ import annotations

import json
import sys
from pathlib import Path


def load_rows(path: str) -> list[dict]:
    rows: list[dict] = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        text = line.strip()
        if not text:
            continue
        rows.append(json.loads(text))
    return rows


def _ranges(rows: list[dict]) -> list[dict]:
    holds = [row for row in rows if row.get("stage") == "mode_hold_spans"]
    modes = [row for row in rows if row.get("stage") == "mode_ranges"]
    source = holds[-1]["ranges"] if holds else []
    if not source and modes:
        source = modes[-1].get("ranges") or []
    mode_by_key = {}
    if modes:
        for item in modes[-1].get("ranges") or []:
            key = tuple(item.get("output_frames") or [])
            mode_by_key[key] = item
    merged = []
    for item in source:
        key = tuple(item.get("output_frames") or [])
        other = mode_by_key.get(key, {})
        merged.append({**other, **item})
    return merged


def _split_runs(rows: list[dict], stage: str) -> list[tuple[int, int]]:
    runs: list[tuple[int, int]] = []
    for row in rows:
        if row.get("stage") != stage:
            continue
        for run in row.get("runs") or []:
            if run.get("split"):
                runs.append((int(run["start"]), int(run["end"])))
    return runs


def _overlaps(start: int, end: int, other_start: int, other_end: int) -> bool:
    return start < other_end and other_start < end


def _crop_events(
    rows: list[dict], start: int, end: int, mode: str
) -> list[dict]:
    if mode == "split":
        events = []
        for row in rows:
            if row.get("stage") != "ffmpeg_crop_init" or row.get("mode") != "split":
                continue
            frames = row.get("output_frames") or []
            if len(frames) < 2:
                continue
            run_start, run_end = int(frames[0]), int(frames[1])
            if not _overlaps(start, end, run_start, run_end):
                continue
            events.append(
                {
                    "output_frame": max(start, run_start),
                    "crop": {
                        "top": row.get("top_crop"),
                        "bottom": row.get("bottom_crop"),
                    },
                    "zoom_source": row.get("zoom_source"),
                    "zoom_applied": row.get("zoom_applied"),
                }
            )
        events.sort(key=lambda row: int(row["output_frame"]))
        return events

    events = [
        row for row in rows
        if row.get("stage") == "ffmpeg_crop_applied" and "output_frame" in row
    ]
    events.sort(key=lambda row: int(row["output_frame"]))
    prior = [row for row in events if int(row["output_frame"]) <= start]
    inside = [row for row in events if start < int(row["output_frame"]) < end]
    chosen = []
    if prior:
        chosen.append(prior[-1])
    chosen.extend(inside)
    return chosen


def _causes(rows: list[dict], item: dict, probes: list[dict], crops: list[dict]) -> list[str]:
    start, end = (int(value) for value in item.get("output_frames") or [0, 0])
    found: list[str] = []
    few_or_held = False
    for row in rows:
        if row.get("stage") != "mono_temporal_lock":
            continue
        frames = row.get("frames") or [0, 0]
        if len(frames) < 2 or not _overlaps(start, end, int(frames[0]), int(frames[1])):
            continue
        samples = int(row.get("sample_frames") or 0)
        if row.get("lock_decision") == "held" or samples <= 2:
            few_or_held = True
    for row in rows:
        if row.get("stage") != "mono_track_samples":
            continue
        selected = row.get("selected") or {}
        first = selected.get("first_frame")
        last = selected.get("last_frame")
        if first is None or last is None:
            continue
        if not _overlaps(start, end, int(first), int(last) + 1):
            continue
        if len(selected.get("samples") or []) <= 2:
            few_or_held = True
    if few_or_held:
        found.append("mono : peu d'échantillons, ou reprise du lock précédent")

    labels: dict[str, set[str]] = {}
    same_person = False
    for probe in probes:
        if probe.get("same_person_suspect"):
            same_person = True
        for face in probe.get("faces") or []:
            labels.setdefault(str(face.get("label")), set()).add(str(face.get("panel")))
    if same_person or any(len(panels) > 1 for panels in labels.values()):
        found.append("split : même visage suspect, ou continuité qui change de panneau")

    if item.get("rendered_mode") == "mono":
        candidates = _split_runs(rows, "split_candidate_summary")
        armed = _split_runs(rows, "split_preflight_summary")
        for left, right in candidates:
            overlap_start = max(start, left)
            overlap_end = min(end, right)
            if overlap_start >= overlap_end:
                continue
            covered = all(
                any(run_start <= frame < run_end for run_start, run_end in armed)
                for frame in range(overlap_start, overlap_end)
            )
            if not covered:
                found.append("mono gardé alors qu'un split était candidat")
                break

    if any(
        crop.get("zoom_source") is not None
        and crop.get("zoom_applied") is not None
        and abs(float(crop["zoom_source"]) - float(crop["zoom_applied"])) > 1e-3
        for crop in crops
    ):
        found.append("zoom calculé et zoom fixe différents")
    return found


def summarize(rows: list[dict]) -> str:
    """Return the text report for one JSONL trace."""
    blocks: list[str] = []
    for item in _ranges(rows):
        frames = item.get("output_frames") or [0, 0]
        start, end = int(frames[0]), int(frames[1])
        probes = [
            row for row in rows
            if row.get("stage") == "split_probe_faces"
            and start <= int(row.get("output_frame") or -1) < end
        ]
        mode = str(item.get("rendered_mode") or "mono")
        crops = _crop_events(rows, start, end, mode)
        holds = item.get("hold_spans") or []
        reason = item.get("reason")
        lines = [
            f"plage {start}:{end} mode={item.get('rendered_mode')}",
            "  raisons: " + (str(reason) if reason else "aucune"),
        ]
        if holds:
            rendered = ", ".join(
                f"{span['start']}:{span['end']} {span['reason']}" for span in holds
            )
            lines.append(
                f"  maintiens: {item.get('unvalidated_frames', len(holds))} image(s) — {rendered}"
            )
        else:
            lines.append("  maintiens: aucun")
        lines.append(
            "  same_person_suspect: "
            + ("oui" if any(probe.get("same_person_suspect") for probe in probes) else "non")
        )
        if not crops:
            lines.append("  crop: aucun")
            lines.append("  zoom_source: aucun")
            lines.append("  zoom_applied: aucun")
        else:
            for crop in crops:
                rect = crop.get("crop") or []
                if mode == "split" and isinstance(rect, dict):
                    top = ",".join(str(value) for value in (rect.get("top") or []))
                    bottom = ",".join(str(value) for value in (rect.get("bottom") or []))
                    lines.append(
                        f"  crop: frame {crop.get('output_frame')} "
                        f"top={top} bottom={bottom} "
                        f"zoom_source={crop.get('zoom_source') or 'aucun'} "
                        f"zoom_applied={crop.get('zoom_applied')}"
                    )
                else:
                    rendered_rect = ",".join(str(value) for value in rect)
                    lines.append(
                        f"  crop: frame {crop.get('output_frame')} {rendered_rect} "
                        f"zoom_source={crop.get('zoom_source')} zoom_applied={crop.get('zoom_applied')}"
                    )
        causes = _causes(rows, item, probes, crops)
        if causes:
            lines.append("  causes:")
            lines.extend(f"  - {cause}" for cause in causes)
        else:
            lines.append("  causes: aucune des quatre causes")
        blocks.append("\n".join(lines))
    if not blocks:
        return "aucune plage\n"
    return "\n\n".join(blocks) + "\n"


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) != 1:
        print(
            "usage: python summarize_camera_trace.py <fichier.camtrace.jsonl>",
            file=sys.stderr,
        )
        return 2
    sys.stdout.write(summarize(load_rows(args[0])))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
