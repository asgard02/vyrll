"""Non-biometric BlazeFace box tracker used by CAMERA_TRACKER_V3.

The tracker deliberately consumes only transient geometry (bounding boxes and
eye anchors).  It never computes, stores, or serializes a face embedding.
"""

from __future__ import annotations

from dataclasses import dataclass
import math

import numpy as np


Box = tuple[float, float, float, float]
Point = tuple[float, float]


@dataclass(frozen=True)
class V3Detection:
    bbox: Box
    eye_anchor: Point | None
    confidence: float

    @property
    def center(self) -> Point:
        x, y, w, h = self.bbox
        if self.eye_anchor is not None:
            return self.eye_anchor
        return (x + w * 0.5, y + h * 0.42)

    @property
    def area(self) -> float:
        return max(0.0, self.bbox[2]) * max(0.0, self.bbox[3])


@dataclass(frozen=True)
class V3TrackView:
    track_id: int
    bbox: Box
    eye_anchor: Point | None
    confidence: float
    frame_index: int
    shot_id: int
    detected: bool
    hits: int
    duration_sec: float
    confirmed: bool

    @property
    def center(self) -> Point:
        x, y, w, h = self.bbox
        if self.eye_anchor is not None:
            return self.eye_anchor
        return (x + w * 0.5, y + h * 0.42)

    @property
    def area(self) -> float:
        return max(0.0, self.bbox[2]) * max(0.0, self.bbox[3])


def bbox_iou(a: Box, b: Box) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    x0, y0 = max(ax, bx), max(ay, by)
    x1, y1 = min(ax + aw, bx + bw), min(ay + ah, by + bh)
    intersection = max(0.0, x1 - x0) * max(0.0, y1 - y0)
    union = max(1e-9, aw * ah + bw * bh - intersection)
    return intersection / union


class _BoxKalman:
    """Small constant-velocity Kalman filter over normalized ``cx, cy, w, h``."""

    def __init__(self, bbox: Box) -> None:
        x, y, w, h = bbox
        self.state = np.array(
            [x + w * 0.5, y + h * 0.5, w, h, 0.0, 0.0, 0.0, 0.0],
            dtype=np.float64,
        )
        self.covariance = np.eye(8, dtype=np.float64) * 0.08

    def predict(self, dt: float) -> Box:
        step = max(1e-3, min(float(dt), 1.0))
        transition = np.eye(8, dtype=np.float64)
        for index in range(4):
            transition[index, index + 4] = step
        process_noise = np.eye(8, dtype=np.float64) * 0.0025
        process_noise[4:, 4:] *= 2.0
        self.state = transition @ self.state
        self.covariance = (
            transition @ self.covariance @ transition.T + process_noise
        )
        return self.bbox

    def update(self, bbox: Box) -> Box:
        x, y, w, h = bbox
        measurement = np.array(
            [x + w * 0.5, y + h * 0.5, w, h], dtype=np.float64
        )
        observation = np.zeros((4, 8), dtype=np.float64)
        observation[:4, :4] = np.eye(4, dtype=np.float64)
        noise = np.eye(4, dtype=np.float64) * 0.006
        innovation = measurement - observation @ self.state
        residual = observation @ self.covariance @ observation.T + noise
        gain = self.covariance @ observation.T @ np.linalg.inv(residual)
        self.state = self.state + gain @ innovation
        self.covariance = (np.eye(8) - gain @ observation) @ self.covariance
        return self.bbox

    @property
    def bbox(self) -> Box:
        cx, cy, w, h = (float(value) for value in self.state[:4])
        w = max(0.01, min(1.0, w))
        h = max(0.01, min(1.0, h))
        x = max(0.0, min(1.0 - w, cx - w * 0.5))
        y = max(0.0, min(1.0 - h, cy - h * 0.5))
        return (x, y, w, h)


@dataclass
class _Track:
    track_id: int
    shot_id: int
    kalman: _BoxKalman
    first_seen_sec: float
    last_update_sec: float
    last_detected_sec: float
    last_frame: int
    hits: int
    misses: int
    eye_anchor: Point | None
    confidence: float


class BlazeFaceBoxTracker:
    """Associate BlazeFace boxes without biometric identity information."""

    def __init__(
        self,
        *,
        confirm_hits: int = 3,
        confirm_seconds: float = 0.8,
        max_missing_seconds: float = 0.6,
        max_center_distance: float = 0.22,
        min_iou: float = 0.02,
    ) -> None:
        self.confirm_hits = max(1, int(confirm_hits))
        self.confirm_seconds = max(0.0, float(confirm_seconds))
        self.max_missing_seconds = max(0.0, float(max_missing_seconds))
        self.max_center_distance = max(0.01, float(max_center_distance))
        self.min_iou = max(0.0, float(min_iou))
        self._active: dict[int, _Track] = {}
        self._next_id = 1
        self._shot_id: int | None = None

    def reset(self, shot_id: int) -> None:
        self._active.clear()
        self._shot_id = int(shot_id)

    def update(
        self,
        frame_index: int,
        time_sec: float,
        shot_id: int,
        detections: list[V3Detection],
    ) -> list[V3TrackView]:
        now = float(time_sec)
        if self._shot_id != int(shot_id):
            self.reset(int(shot_id))

        predicted: dict[int, Box] = {}
        for track_id, track in sorted(self._active.items()):
            predicted[track_id] = track.kalman.predict(now - track.last_update_sec)
            track.last_update_sec = now

        pairs: list[tuple[float, int, int]] = []
        for track_id, bbox in predicted.items():
            tx, ty, tw, th = bbox
            track_center = (tx + tw * 0.5, ty + th * 0.5)
            for detection_index, detection in enumerate(detections):
                dx, dy = detection.center
                distance = math.hypot(dx - track_center[0], dy - track_center[1])
                overlap = bbox_iou(bbox, detection.bbox)
                if distance > self.max_center_distance:
                    continue
                if overlap < self.min_iou and distance > 0.10:
                    continue
                cost = 0.65 * (1.0 - overlap) + 0.35 * (
                    distance / self.max_center_distance
                )
                pairs.append((cost, track_id, detection_index))

        matched_tracks: set[int] = set()
        matched_detections: set[int] = set()
        for _cost, track_id, detection_index in sorted(pairs):
            if track_id in matched_tracks or detection_index in matched_detections:
                continue
            track = self._active.get(track_id)
            if track is None:
                continue
            detection = detections[detection_index]
            track.kalman.update(detection.bbox)
            track.last_detected_sec = now
            track.last_frame = int(frame_index)
            track.hits += 1
            track.misses = 0
            track.eye_anchor = detection.eye_anchor
            track.confidence = detection.confidence
            matched_tracks.add(track_id)
            matched_detections.add(detection_index)

        for detection_index, detection in enumerate(detections):
            if detection_index in matched_detections:
                continue
            track_id = self._next_id
            self._next_id += 1
            self._active[track_id] = _Track(
                track_id=track_id,
                shot_id=int(shot_id),
                kalman=_BoxKalman(detection.bbox),
                first_seen_sec=now,
                last_update_sec=now,
                last_detected_sec=now,
                last_frame=int(frame_index),
                hits=1,
                misses=0,
                eye_anchor=detection.eye_anchor,
                confidence=detection.confidence,
            )
            matched_tracks.add(track_id)

        expired: list[int] = []
        for track_id, track in self._active.items():
            if track_id not in matched_tracks:
                track.misses += 1
                track.eye_anchor = None
                track.confidence *= 0.82
            if now - track.last_detected_sec > self.max_missing_seconds:
                expired.append(track_id)
        for track_id in expired:
            self._active.pop(track_id, None)

        views: list[V3TrackView] = []
        for track_id, track in sorted(self._active.items()):
            duration = max(0.0, track.last_detected_sec - track.first_seen_sec)
            detected = track_id in matched_tracks
            views.append(
                V3TrackView(
                    track_id=track_id,
                    bbox=track.kalman.bbox,
                    eye_anchor=track.eye_anchor,
                    confidence=float(track.confidence),
                    frame_index=int(frame_index),
                    shot_id=int(shot_id),
                    detected=detected,
                    hits=track.hits,
                    duration_sec=duration,
                    confirmed=(
                        track.hits >= self.confirm_hits
                        and duration >= self.confirm_seconds
                    ),
                )
            )
        return sorted(views, key=lambda item: item.center[0])
