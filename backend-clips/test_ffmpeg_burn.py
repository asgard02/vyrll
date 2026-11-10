import os
import re
import subprocess
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO

import cv2
import numpy as np

import ffmpeg_burn as fb


class TestFfmpegBurnHelpers(unittest.TestCase):
    def test_ass_timestamp(self):
        self.assertEqual(fb.ass_timestamp(0), "0:00:00.00")
        self.assertEqual(fb.ass_timestamp(1.23), "0:00:01.23")
        self.assertEqual(fb.ass_timestamp(61.5), "0:01:01.50")

    def test_hex_to_ass(self):
        self.assertEqual(fb.hex_to_ass("#FFD700"), "&H0000D7FF")
        self.assertEqual(fb.hex_to_ass("#FFFFFF"), "&H00FFFFFF")

    def test_even_int(self):
        self.assertEqual(fb.even_int(1081), 1080)
        self.assertEqual(fb.even_int(1), 2)

    def test_square_pillarbox_phone_canvas(self):
        self.assertEqual(fb.square_pillarbox(1080, 1920, True), (1080, 1080, 420))
        self.assertEqual(fb.square_pillarbox(720, 1280, True), (720, 720, 280))
        self.assertEqual(fb.square_pillarbox(1080, 1920, False), (1080, 1920, 0))
        self.assertEqual(fb.square_pillarbox(1080, 1080, True), (1080, 1080, 0))

    def test_yuv_pre_tail_pads_square(self):
        self.assertEqual(
            fb.yuv_pre_tail(1080, 1920, 420),
            "pad=1080:1920:0:420:black,format=yuv420p[pre]",
        )
        self.assertEqual(fb.yuv_pre_tail(1080, 1920, 0), "format=yuv420p[pre]")

    def test_letterbox_on_canvas_centers_square(self):
        import render_subtitles as rs

        sq = np.full((1080, 1080, 3), 255, dtype=np.uint8)
        canvas = rs.letterbox_on_canvas(sq, 1080, 1920, 420)
        self.assertEqual(canvas.shape, (1920, 1080, 3))
        self.assertEqual(int(canvas[0, 540, 0]), 0)
        self.assertEqual(int(canvas[419, 540, 0]), 0)
        self.assertEqual(int(canvas[420, 540, 0]), 255)
        self.assertEqual(int(canvas[1499, 540, 0]), 255)
        self.assertEqual(int(canvas[1500, 540, 0]), 0)

    def test_camera_timeline_waits_for_valid_split_locks(self):
        import render_subtitles as rs

        cx = np.full(8, 0.72, dtype=np.float32)
        cy = np.full(8, 0.35, dtype=np.float32)
        mask = np.array([False, False, True, True, True, True, False, False])
        top = np.full((8, 2), np.nan, dtype=np.float64)
        bottom = np.full((8, 2), np.nan, dtype=np.float64)
        top[3:6] = (0.28, 0.35)
        bottom[3:6] = (0.72, 0.35)
        states = rs.build_camera_timeline(
            frame_count=8,
            out_fps=24.0,
            fps_src=24.0,
            cx_source=cx,
            cy_source=cy,
            zoom_source=None,
            split_mask=mask,
            split_lock_top=top,
            split_lock_bottom=bottom,
        )
        self.assertEqual(states[2].mode, "mono")
        self.assertFalse(states[2].validated)
        self.assertEqual(states[3].mode, "split")
        self.assertTrue(states[3].validated)

    def test_timeline_mode_ranges_keep_candidate_and_source_zoom(self):
        import render_subtitles as rs

        states = rs.build_camera_timeline(
            frame_count=6,
            out_fps=24.0,
            fps_src=24.0,
            cx_source=np.full(6, 0.40, dtype=np.float32),
            cy_source=np.full(6, 0.32, dtype=np.float32),
            zoom_source=np.full(6, 1.10, dtype=np.float32),
            split_mask=np.array([False, False, True, True, False, False]),
            split_lock_top=np.tile(np.array([0.25, 0.35]), (6, 1)),
            split_lock_bottom=np.tile(np.array([0.75, 0.35]), (6, 1)),
        )
        candidate = np.array([False, True, True, True, True, False])
        ranges = rs._timeline_mode_ranges(
            states,
            out_fps=24.0,
            fps_src=24.0,
            candidate_mask=candidate,
            preflight_mask=np.array([False, False, True, True, False, False]),
            zoom_source=np.full(6, 1.10, dtype=np.float32),
        )
        self.assertEqual([item["rendered_mode"] for item in ranges], ["mono", "split", "mono"])
        self.assertEqual(ranges[0]["candidate_split_frames"], 1)
        self.assertEqual(ranges[0]["preflight_split_frames"], 0)
        self.assertEqual(ranges[0]["zoom_source"], 1.1)
        self.assertEqual(ranges[1]["output_frames"], [2, 4])
        self.assertEqual(ranges[1]["reason"], "legacy_split_validated")

    def test_debug_flag_keeps_timeline_and_records_hold_spans(self):
        import camera_debug_trace
        import render_subtitles as rs

        cx = np.array([0.40, 0.40, np.nan, 0.40], dtype=np.float32)
        cy = np.array([0.32, 0.32, 0.32, 0.32], dtype=np.float32)
        zoom = np.full(4, 1.10, dtype=np.float32)
        mask = np.zeros(4, dtype=bool)
        locks = np.full((4, 2), np.nan)

        def snapshot():
            states = rs.build_camera_timeline(
                frame_count=4,
                out_fps=24.0,
                fps_src=24.0,
                cx_source=cx,
                cy_source=cy,
                zoom_source=zoom,
                split_mask=mask,
                split_lock_top=locks,
                split_lock_bottom=locks,
            )
            ranges = rs._timeline_mode_ranges(
                states,
                out_fps=24.0,
                fps_src=24.0,
                candidate_mask=mask,
                preflight_mask=mask,
                zoom_source=zoom,
            )
            return states, ranges

        previous = os.environ.pop("CAMERA_DEBUG_TRACE", None)
        camera_debug_trace.reset()
        try:
            off_states, off_ranges = snapshot()
            off_log = StringIO()
            with redirect_stdout(off_log):
                rs._camtrace("mode_ranges", source="v1_timeline", ranges=off_ranges)
            os.environ["CAMERA_DEBUG_TRACE"] = "1"
            on_states, on_ranges = snapshot()
            on_log = StringIO()
            with tempfile.TemporaryDirectory() as tmp:
                output = os.path.join(tmp, "clip.mp4")
                with redirect_stdout(on_log):
                    camera_debug_trace.set_output_path(output)
                    rs._camtrace("mode_ranges", source="v1_timeline", ranges=on_ranges)
                trace_path = output + ".camtrace.jsonl"
                self.assertTrue(os.path.isfile(trace_path))
                copied = open(trace_path, encoding="utf-8").read()
                hold_log = StringIO()
                with redirect_stdout(hold_log):
                    camera_debug_trace.emit(
                        "mode_hold_spans",
                        source="v1_timeline",
                        ranges=rs.mode_hold_spans(on_states),
                    )
                trace_text = open(trace_path, encoding="utf-8").read()
            self.assertEqual(off_log.getvalue(), on_log.getvalue())
            self.assertEqual(copied, on_log.getvalue().removeprefix("[CAMTRACE] "))
            self.assertIn('"stage":"mode_hold_spans"', hold_log.getvalue())
            os.environ.pop("CAMERA_DEBUG_TRACE", None)
            camera_debug_trace.reset()
            silent = StringIO()
            with tempfile.TemporaryDirectory() as tmp:
                output = os.path.join(tmp, "clip.mp4")
                with redirect_stdout(silent):
                    camera_debug_trace.set_output_path(output)
                    camera_debug_trace.emit(
                        "mode_hold_spans",
                        source="v1_timeline",
                        ranges=rs.mode_hold_spans(off_states),
                    )
                self.assertFalse(os.path.exists(output + ".camtrace.jsonl"))
        finally:
            if previous is None:
                os.environ.pop("CAMERA_DEBUG_TRACE", None)
            else:
                os.environ["CAMERA_DEBUG_TRACE"] = previous
            camera_debug_trace.reset()

        self.assertEqual(off_states, on_states)
        self.assertEqual(off_ranges, on_ranges)
        self.assertNotIn("mode_hold_spans", silent.getvalue())
        self.assertEqual([state.mode for state in off_states], ["mono"] * 4)
        self.assertTrue(off_states[1].validated)
        self.assertFalse(off_states[2].validated)
        self.assertEqual(off_ranges[0]["reason"], "legacy_mono_validated")
        self.assertNotIn("hold_spans", off_ranges[0])
        self.assertNotIn("unvalidated_frames", off_ranges[0])
        holds = rs.mode_hold_spans(off_states)
        self.assertEqual(holds[0]["unvalidated_frames"], 1)
        self.assertEqual(
            holds[0]["hold_spans"],
            [{"start": 2, "end": 3, "reason": "legacy_hold_invalid"}],
        )
        self.assertIn('"stage":"mode_ranges"', trace_text)
        self.assertIn('"stage":"mode_hold_spans"', trace_text)
        self.assertIn('"start":2,"end":3,"reason":"legacy_hold_invalid"', trace_text)

        mixed = [
            rs.CameraFrameState(
                "mono", (0.4, 0.3), 1.1, None, None, 0.0, True, reason="legacy_mono_validated"
            ),
            rs.CameraFrameState(
                "mono", (0.4, 0.3), 1.1, None, None, 0.0, False, reason="legacy_hold_invalid"
            ),
            rs.CameraFrameState(
                "mono", (0.4, 0.3), 1.1, None, None, 0.0, False, reason="legacy_hold_invalid"
            ),
            rs.CameraFrameState(
                "mono", (0.4, 0.3), 1.1, None, None, 0.0, True, reason="legacy_mono_validated"
            ),
            rs.CameraFrameState(
                "mono", (0.4, 0.3), 1.1, None, None, 0.0, False, reason="other_hold"
            ),
        ]
        self.assertEqual(
            rs.mode_hold_spans(mixed)[0]["hold_spans"],
            [
                {"start": 1, "end": 3, "reason": "legacy_hold_invalid"},
                {"start": 4, "end": 5, "reason": "other_hold"},
            ],
        )

    def test_camera_timeline_uses_one_source_mapping(self):
        import render_subtitles as rs

        self.assertEqual(rs.output_frame_source_index(5, 24.0, 24.0, 100), 5)
        self.assertEqual(rs.output_frame_source_index(4, 30.0, 24.0, 100), 5)
        self.assertEqual(rs.output_frame_source_index(1, 25.0, 25.0, 100), 1)
        self.assertEqual(rs.output_frame_source_index(4, 60.0, 24.0, 100), 10)

    def test_mono_temporal_lock_rejects_static_object_track(self):
        import render_subtitles as rs

        samples = []
        for frame in range(0, 64, 8):
            # A large, perfectly repeated detector box models a static prop or
            # background graphic.  The smaller face persists too, but moves
            # coherently from frame to frame.
            samples.append((frame, 0.79, 0.30, 9.2, 0.080, 0.0002))
            face_x = 0.47 + 0.006 * (frame // 8)
            samples.append(
                (frame, face_x, 0.32, 7.6, 0.036 + frame * 0.00001, 0.014)
            )

        lock, meta = rs._temporal_eye_lock(samples, prefer_cx=0.42)

        self.assertIsNotNone(lock)
        self.assertLess(abs(lock[0] - 0.491), 0.03)
        self.assertEqual(meta["reason"], "persistent_coherent_track")
        self.assertEqual(meta["rejected_static_tracks"], 1)
        self.assertGreaterEqual(meta["persistence"], 0.99)
        self.assertGreaterEqual(meta["box_coherence"], 0.99)
        summaries = meta["track_summaries"]
        self.assertEqual(len(summaries), 2)
        static = next(item for item in summaries if item["visually_static"])
        moving = next(item for item in summaries if not item["visually_static"])
        self.assertGreater(static["frozen_ratio"], 0.9)
        self.assertGreater(moving["motion_signal"], 0.45)
        self.assertEqual(meta["selected_track"], moving["track"])

    def test_mono_track_samples_follow_debug_flag_without_changing_lock(self):
        import json

        import camera_debug_trace
        import render_subtitles as rs

        samples = []
        for frame in range(0, 64, 8):
            samples.append((frame, 0.79, 0.30, 9.2, 0.080, 0.0002))
            face_x = 0.47 + 0.006 * (frame // 8)
            samples.append((frame, face_x, 0.32, 7.6, 0.036 + frame * 0.00001, 0.014))

        previous = os.environ.pop("CAMERA_DEBUG_TRACE", None)
        camera_debug_trace.reset()
        try:
            off_log = StringIO()
            with redirect_stdout(off_log):
                lock_off, meta_off = rs._temporal_eye_lock(samples, prefer_cx=0.42)
            os.environ["CAMERA_DEBUG_TRACE"] = "1"
            on_log = StringIO()
            with tempfile.TemporaryDirectory() as tmp:
                output = os.path.join(tmp, "clip.mp4")
                with redirect_stdout(on_log):
                    camera_debug_trace.set_output_path(output)
                    lock_on, meta_on = rs._temporal_eye_lock(samples, prefer_cx=0.42)
                trace_text = open(output + ".camtrace.jsonl", encoding="utf-8").read()
        finally:
            if previous is None:
                os.environ.pop("CAMERA_DEBUG_TRACE", None)
            else:
                os.environ["CAMERA_DEBUG_TRACE"] = previous
            camera_debug_trace.reset()

        self.assertEqual(lock_off, lock_on)
        self.assertEqual(meta_off, meta_on)
        self.assertNotIn("first_frame", meta_off["track_summaries"][0])
        self.assertEqual(off_log.getvalue(), "")
        row = json.loads(trace_text)
        self.assertEqual(row["stage"], "mono_track_samples")
        self.assertEqual(row["selected"]["first_frame"], 0)
        self.assertEqual(row["selected"]["last_frame"], 56)
        self.assertEqual(row["selected"]["samples"][0]["frame"], 0)
        self.assertEqual(row["selected"]["samples"][-1]["frame"], 56)
        self.assertEqual(row["rejected"]["first_frame"], 0)
        self.assertEqual(row["rejected"]["last_frame"], 56)
        self.assertIn('"stage":"mono_track_samples"', on_log.getvalue())

    def test_mono_lock_trace_names_a_held_default_without_moving_centers(self):
        import render_subtitles as rs

        class GrayCap:
            def __init__(self):
                self.frame = np.full((32, 48, 3), 20, dtype=np.uint8)
                self.left = 8

            def read(self):
                if self.left <= 0:
                    return False, None
                self.left -= 1
                return True, self.frame.copy()

            def set(self, *_args):
                return True

        original_candidates = rs.detect_face_candidates_scored
        original_center = rs.detect_face_center_scored
        rs.detect_face_candidates_scored = lambda *_args, **_kwargs: []
        rs.detect_face_center_scored = lambda *_args, **_kwargs: None
        log = StringIO()
        try:
            with redirect_stdout(log):
                cx, cy, _zoom = rs.collect_crop_positions(GrayCap(), 0, 8, 24.0)
        finally:
            rs.detect_face_candidates_scored = original_candidates
            rs.detect_face_center_scored = original_center

        self.assertTrue(np.allclose(cx, rs._DEFAULT_CX))
        self.assertTrue(np.allclose(cy, rs._DEFAULT_CY))
        text = log.getvalue()
        self.assertIn('"stage":"mono_temporal_lock"', text)
        self.assertIn('"lock_decision":"held"', text)
        self.assertIn('"zoom_source":', text)

    def test_camera_v2_split_is_backdated_and_ends_on_first_of_two_misses(self):
        import render_subtitles as rs

        def face(track_id, x, frame, shot=0):
            return rs.FaceObservation(
                track_id=track_id,
                bbox=(x - 0.06, 0.20, 0.12, 0.16),
                eye_anchor=(x, 0.25),
                face_confidence=0.92,
                mouth_activity=0.1,
                frame_index=frame,
                shot_id=shot,
            )

        samples = [
            (0, 0, [face(1, 0.25, 0), face(2, 0.75, 0)]),
            (5, 0, [face(1, 0.26, 5), face(2, 0.74, 5)]),
            (10, 0, [face(1, 0.27, 10), face(2, 0.73, 10)]),
            (15, 0, [face(1, 0.27, 15)]),
            (20, 0, [face(1, 0.27, 20)]),
        ]
        states = rs.plan_camera_samples_v2(
            samples,
            source_aspect=16 / 9,
            out_fps=25.0,
            frame_count=25,
            source_fps=25.0,
        )
        self.assertTrue(all(state.mode == "split" for state in states[:15]))
        self.assertTrue(all(state.mode != "split" for state in states[15:]))
        self.assertEqual(states[0].split_track_ids, (1, 2))

    def test_camera_v2_carries_one_missing_detection_then_drops_track(self):
        import render_subtitles as rs

        measurement = ((0.2, 0.2, 0.12, 0.16), (0.26, 0.25), 0.9, 0.2)
        tracked, histories = rs.assign_face_tracks(
            [(0, 0, [measurement]), (5, 0, []), (10, 0, [])]
        )
        track_id = tracked[0][2][0].track_id
        self.assertEqual(tracked[1][2][0].track_id, track_id)
        self.assertFalse(tracked[1][2][0].detected)
        self.assertEqual(tracked[2][2], [])
        self.assertEqual(len(histories[track_id]), 2)

    def test_camera_v2_resets_identity_on_a_cut(self):
        import render_subtitles as rs

        measurement = ((0.2, 0.2, 0.12, 0.16), (0.26, 0.25), 0.9, 0.2)
        tracked, _ = rs.assign_face_tracks([(0, 0, [measurement]), (5, 1, [measurement])])
        self.assertNotEqual(tracked[0][2][0].track_id, tracked[1][2][0].track_id)

    def test_camera_v2_safe_wide_without_reliable_face(self):
        import render_subtitles as rs

        states = rs.plan_camera_samples_v2(
            [(0, 0, []), (5, 0, [])],
            source_aspect=16 / 9,
            out_fps=25.0,
            frame_count=10,
        )
        self.assertTrue(all(state.mode == "safe_wide" for state in states))
        self.assertTrue(all(state.mono_center == (0.5, 0.42) for state in states))

    def test_camera_v2_switches_mono_speaker_after_three_better_samples(self):
        import render_subtitles as rs

        def face(track_id, x, frame, mouth):
            return rs.FaceObservation(
                track_id=track_id,
                bbox=(x - 0.045, 0.20, 0.09, 0.13),
                eye_anchor=(x, 0.24),
                face_confidence=0.9,
                mouth_activity=mouth,
                frame_index=frame,
                shot_id=0,
            )

        # Faces are intentionally too close for split; track 2 becomes the
        # active speaker and must win three consecutive 0.2s samples.
        samples = []
        for i, frame in enumerate((0, 5, 10, 15, 20)):
            samples.append(
                (
                    frame,
                    0,
                    [
                        face(1, 0.44, frame, 0.45 if i == 0 else 0.02),
                        face(2, 0.56, frame, 0.02 if i == 0 else 0.90),
                    ],
                )
            )
        states = rs.plan_camera_samples_v2(
            samples,
            source_aspect=16 / 9,
            out_fps=25.0,
            frame_count=25,
            speech_intervals=[(0.0, 1.0)],
        )
        self.assertEqual(states[0].track_id, 1)
        self.assertEqual(states[20].track_id, 2)

    def test_split_sendcmd_tracks_both_people_per_output_frame(self):
        centers = np.array([[0.25, 0.3], [0.30, 0.3], [0.35, 0.3]], dtype=np.float64)
        text = fb.build_center_sendcmd_fixed(
            centers,
            start_frame=0,
            end_frame=3,
            out_fps=25.0,
            src_w=1000,
            src_h=600,
            crop_w=300,
            crop_h=300,
            eye_y=0.36,
            fallback=(0.25, 0.3),
        )
        commands = [line for line in text.splitlines() if line]
        self.assertEqual(len(commands), 3)
        self.assertIn("0.000000", commands[0])
        self.assertIn("0.040000", commands[1])
        self.assertIn("0.080000", commands[2])

    def test_preflight_never_backfills_before_first_clean_split_frame(self):
        import render_subtitles as rs

        # The candidate begins at frame 2, but the actual source does not show
        # two valid faces until frames 4 and 5. The preflight must begin at 4,
        # never at the coarse candidate boundary.
        def fake_decode(_video, _start, first, last, _fps):
            return [np.full((404, 720, 3), first + i, dtype=np.uint8) for i in range(last - first)]

        def fake_assess(frame):
            idx = int(frame[0, 0, 0])
            if 4 <= idx < 8:
                return rs.SplitClean(
                    True,
                    left=(0.25, 0.35),
                    right=(0.75, 0.35),
                    area_left=0.04,
                    area_right=0.04,
                )
            return rs.SplitClean(False, reason="solo")

        original_decode = rs._decode_exact_output_window
        rs._decode_exact_output_window = fake_decode
        try:
            refined, top, bottom = rs.preflight_split_segments(
                "source.mp4",
                0.0,
                1.0,
                10.0,
                np.array([False, False] + [True] * 4 + [False] * 4),
                verify_window_sec=0.5,
                min_verify_hits=2,
                assess_fn=fake_assess,
            )
        finally:
            rs._decode_exact_output_window = original_decode

        self.assertFalse(refined[2])
        self.assertFalse(refined[3])
        self.assertTrue(refined[4])
        self.assertTrue(refined[7])
        self.assertFalse(refined[8])
        self.assertTrue(np.isfinite(top[4]).all())
        self.assertTrue(np.isfinite(bottom[4]).all())

    def test_preflight_keeps_split_after_one_isolated_crop_check_miss(self):
        import render_subtitles as rs

        def fake_decode(_video, _start, first, last, _fps):
            return [np.full((404, 720, 3), first + i, dtype=np.uint8) for i in range(last - first)]

        def fake_assess(frame):
            # One detector miss at the 1.0s control point must not move the
            # layout. The two startup frames remain valid and arm the segment.
            idx = int(frame[0, 0, 0])
            if idx == 10:
                return rs.SplitClean(False, reason="solo")
            return rs.SplitClean(
                True, left=(0.25, 0.35), right=(0.75, 0.35),
                area_left=0.01, area_right=0.01,
            )

        original_decode = rs._decode_exact_output_window
        rs._decode_exact_output_window = fake_decode
        try:
            refined, top, bottom = rs.preflight_split_segments(
                "source.mp4", 0.0, 3.0, 10.0, np.ones(30, dtype=bool),
                verify_window_sec=0.5, min_verify_hits=2, assess_fn=fake_assess,
            )
        finally:
            rs._decode_exact_output_window = original_decode

        self.assertTrue(refined.all())
        self.assertIsNotNone(top)
        self.assertIsNotNone(bottom)

    def test_preflight_rejects_entire_split_after_two_crop_check_failures(self):
        import render_subtitles as rs

        def fake_decode(_video, _start, first, last, _fps):
            return [np.full((404, 720, 3), first + i, dtype=np.uint8) for i in range(last - first)]

        def fake_assess(frame):
            idx = int(frame[0, 0, 0])
            if idx in (10, 15):
                # Two actual faces still exist, but the left face has moved
                # outside the crop frozen at x=0.25.
                return rs.SplitClean(
                    True, left=(0.68, 0.35), right=(0.90, 0.35),
                    area_left=0.01, area_right=0.01,
                )
            return rs.SplitClean(
                True, left=(0.25, 0.35), right=(0.75, 0.35),
                area_left=0.01, area_right=0.01,
            )

        original_decode = rs._decode_exact_output_window
        rs._decode_exact_output_window = fake_decode
        log = StringIO()
        try:
            with redirect_stdout(log):
                refined, top, bottom = rs.preflight_split_segments(
                    "source.mp4", 0.0, 3.0, 10.0, np.ones(30, dtype=bool),
                    verify_window_sec=0.5, min_verify_hits=2, assess_fn=fake_assess,
                )
        finally:
            rs._decode_exact_output_window = original_decode

        self.assertFalse(refined.any(), "the whole candidate must fall back to mono")
        self.assertIsNone(top)
        self.assertIsNone(bottom)
        text = log.getvalue()
        self.assertIn('"stage":"split_crop_probe"', text)
        self.assertIn('"stage":"split_segment"', text)
        self.assertIn('"accepted":false', text)
        self.assertIn('"has_eyes":', text)
        self.assertIn("preflight reject shot: frames", text)

    def test_preflight_drops_candidate_without_a_valid_pair(self):
        import render_subtitles as rs

        def fake_decode(_video, _start, first, last, _fps):
            return [np.zeros((404, 720, 3), dtype=np.uint8) for _ in range(last - first)]

        original_decode = rs._decode_exact_output_window
        rs._decode_exact_output_window = fake_decode
        try:
            refined, top, bottom = rs.preflight_split_segments(
                "source.mp4", 0.0, 2.0, 10.0, np.ones(20, dtype=bool),
                assess_fn=lambda _frame: rs.SplitClean(False, reason="solo"),
            )
        finally:
            rs._decode_exact_output_window = original_decode

        self.assertFalse(refined.any())
        self.assertIsNone(top)
        self.assertIsNone(bottom)

    def test_output_source_mapping_is_stable_at_24_30_and_60_fps(self):
        import render_subtitles as rs

        for source_fps in (24.0, 30.0, 60.0):
            with self.subTest(source_fps=source_fps):
                self.assertEqual(
                    rs.output_frame_source_index(24, source_fps, 24.0, 10000),
                    int(source_fps),
                )

    def test_even_union_rect(self):
        y0, y1, x0, x1 = fb._even_union_rect(10, 21, 4, 15, 1920, 1080)
        self.assertEqual((y1 - y0) % 2, 0)
        self.assertEqual((x1 - x0) % 2, 0)
        self.assertGreaterEqual(y0, 0)
        self.assertLessEqual(y1, 1920)

    def test_mono_crop_in_bounds(self):
        x, y, w, h = fb.mono_crop_rect(1920, 1080, 1080, 1920, 0.5, 0.32, 1.24)
        self.assertEqual(w % 2, 0)
        self.assertEqual(h % 2, 0)
        self.assertGreaterEqual(x, 0)
        self.assertGreaterEqual(y, 0)
        self.assertLessEqual(x + w, 1920)
        self.assertLessEqual(y + h, 1080)

    def test_mask_runs_merges_short(self):
        mask = np.array([1, 1, 1, 0, 0, 1, 1, 1, 1], dtype=bool)
        runs = fb.mask_runs(mask, out_fps=10.0, min_run_sec=0.4)
        self.assertTrue(runs)
        self.assertEqual(runs[0][0], 0.0)

    def test_mask_runs_keeps_leading_validated_mono_frames(self):
        # The exact preflight may intentionally hold mono until frame 3. Never
        # backfill those valid mono frames into the upcoming split segment.
        mask = np.array([0, 0, 0] + [1] * 20, dtype=bool)
        runs = fb.mask_runs(mask, out_fps=24.0, min_run_sec=0.35)
        self.assertEqual(len(runs), 2)
        self.assertFalse(runs[0][2])
        self.assertAlmostEqual(runs[1][0], 3 / 24.0)

    def test_shift_blocks_run_relative(self):
        blocks = [
            {
                "bloc_start": 4.0,
                "bloc_end": 6.0,
                "words": [
                    {"word": "hello", "start": 4.0, "end": 4.5},
                    {"word": "late", "start": 8.0, "end": 8.4},
                ],
            }
        ]
        shifted = fb.shift_blocks(blocks, 4.0, 2.0)
        self.assertEqual(len(shifted), 1)
        self.assertAlmostEqual(shifted[0]["bloc_start"], 0.0)
        self.assertAlmostEqual(shifted[0]["bloc_end"], 2.0)
        self.assertEqual(len(shifted[0]["words"]), 1)
        self.assertEqual(shifted[0]["words"][0]["word"], "hello")
        self.assertAlmostEqual(shifted[0]["words"][0]["start"], 0.0)

    def test_shift_blocks_emits_each_word_in_the_run_of_its_start(self):
        blocks = [
            {
                "bloc_start": 1.0,
                "bloc_end": 4.0,
                "words": [
                    {"word": "PROSAIC", "start": 1.2, "end": 1.8},
                    {"word": "LEVEL,", "start": 1.8, "end": 2.4},
                    {"word": "WHAT", "start": 2.4, "end": 3.0},
                ],
            }
        ]
        left = [w["word"] for b in fb.shift_blocks(blocks, 0.0, 2.0) for w in b["words"]]
        right = [w["word"] for b in fb.shift_blocks(blocks, 2.0, 2.0) for w in b["words"]]
        self.assertEqual(left, ["PROSAIC", "LEVEL,"])
        self.assertEqual(right, ["WHAT"])
        self.assertEqual(left.count("LEVEL,"), 1)
        self.assertEqual(right.count("LEVEL,"), 0)
        self.assertEqual(fb.shift_blocks(blocks, 3.0, 1.0), [])

    def test_shift_blocks_zero_gap_does_not_draw_a_word_twice(self):
        blocks = [
            {
                "bloc_start": 12.5,
                "bloc_end": 15.0,
                "words": [
                    {"word": "PROSAIC", "start": 12.5, "end": 13.16},
                    {"word": "LEVEL,", "start": 13.16, "end": 13.84},
                    {"word": "WHAT", "start": 13.84, "end": 14.4},
                    {"word": "WILL", "start": 14.4, "end": 14.9},
                    {"word": "LIFE", "start": 14.9, "end": 15.4},
                ],
            }
        ]
        left = [w["word"] for b in fb.shift_blocks(blocks, 0.0, 13.84) for w in b["words"]]
        right = [w["word"] for b in fb.shift_blocks(blocks, 13.84, 2.0) for w in b["words"]]
        self.assertEqual(left, ["PROSAIC", "LEVEL,"])
        self.assertEqual(right, ["WHAT", "WILL", "LIFE"])
        self.assertEqual(set(left) & set(right), set())

    def test_impact_fit_measures_reserved_slots(self):
        import render_subtitles as rs
        from PIL import Image, ImageDraw

        font_path = rs._resolve_font_path(None)
        words = [
            {"word": "LEVEL", "start": 0.0, "end": 0.4},
            {"word": "WHAT", "start": 0.4, "end": 0.8},
        ]
        _fs, lines, font, _line_h = rs.impact_fit_layout(
            1080, words, "split_vertical", font_path
        )
        margin_x, _budget = rs.impact_fit_budget(1080)
        max_line_w = max(80, 1080 - 2 * margin_x)
        draw = ImageDraw.Draw(Image.new("RGBA", (1080, 8), (0, 0, 0, 0)))
        self.assertEqual([[w["word"] for w in line] for line in lines], [["LEVEL", "WHAT"]])
        slot, word_ws, space_w = rs._impact_line_box(draw, lines[0], font)
        pop = rs.ACTIVE_WORD_POP_IMPACT
        expected = sum(word_w * pop for word_w in word_ws) + space_w
        joined = rs._textlength(draw, "LEVEL WHAT", font)
        self.assertAlmostEqual(slot, expected)
        self.assertGreater(slot, joined)
        self.assertLessEqual(slot, max_line_w)
        self.assertAlmostEqual(expected, word_ws[0] * pop + space_w + word_ws[1] * pop)

    def test_impact_fourteen_chars_in_split(self):
        import render_subtitles as rs
        from PIL import Image, ImageDraw

        text = "WHAT WILL LIFE"
        self.assertEqual(len(text), 14)
        font_path = rs._resolve_font_path(None)
        margin_x, _budget = rs.impact_fit_budget(1080)
        max_line_w = max(80, 1080 - 2 * margin_x)
        self.assertEqual(margin_x, 81)
        self.assertEqual(max_line_w, 918)
        draw = ImageDraw.Draw(Image.new("RGBA", (1080, 8), (0, 0, 0, 0)))
        words = [{"word": part} for part in text.split(" ")]
        ladder = rs.impact_size_ladder(1080, "split_vertical")
        self.assertEqual(ladder[0], 96)
        self.assertEqual(ladder[1], 84)

        def slot_of(size: int) -> float:
            font = rs._load_title_font(font_path, size)
            return rs._impact_line_box(draw, words, font)[0]

        self.assertGreater(slot_of(96), max_line_w)
        self.assertLessEqual(slot_of(84), max_line_w)

    def test_split_blocks_where_words_gap_keeps_a_short_pause(self):
        import render_subtitles as rs

        def block_with_gap(gap: float):
            return [{
                "bloc_start": 0.0,
                "bloc_end": gap + 0.4,
                "words": [
                    {"word": "LEVEL", "start": 0.0, "end": 0.0},
                    {"word": "WHAT", "start": gap, "end": gap + 0.4},
                ],
            }]

        split = rs.split_blocks_where_words_gap(block_with_gap(0.5))
        self.assertEqual([[w["word"] for w in b["words"]] for b in split], [["LEVEL"], ["WHAT"]])
        self.assertLess(split[0]["bloc_end"], split[1]["bloc_start"])

        kept = rs.split_blocks_where_words_gap(block_with_gap(0.15))
        self.assertEqual([[w["word"] for w in b["words"]] for b in kept], [["LEVEL", "WHAT"]])

        touching = rs.split_blocks_where_words_gap(block_with_gap(0.0))
        self.assertEqual([[w["word"] for w in b["words"]] for b in touching], [["LEVEL", "WHAT"]])

    def test_load_blocks_splits_after_voice_snap(self):
        import render_subtitles as rs

        transcription = {
            "text": "LEVEL WHAT",
            "words": [
                {"word": "LEVEL", "start": 0.0, "end": 0.4},
                {"word": "WHAT", "start": 0.4, "end": 0.8},
            ],
        }

        def load_with_gap(gap: float):
            def fake_activity(*_a, **_k):
                return (np.ones(4, dtype=bool), 0.05)

            def fake_snap(bl, *_a, **_k):
                bl[0]["words"][0]["end"] = 0.0
                bl[0]["words"][1]["start"] = gap
                bl[0]["words"][1]["end"] = gap + 0.4
                bl[0]["bloc_end"] = gap + 0.4

            orig_activity = rs.compute_voice_activity
            orig_snap = rs.snap_blocks_to_voice
            rs.compute_voice_activity = fake_activity
            rs.snap_blocks_to_voice = fake_snap
            try:
                return rs._load_blocks_for_clip(
                    transcription, 0.0, 2.0, "karaoke", os.path.abspath(__file__)
                )
            finally:
                rs.compute_voice_activity = orig_activity
                rs.snap_blocks_to_voice = orig_snap

        split = load_with_gap(0.5)
        self.assertEqual([[w["word"] for w in b["words"]] for b in split], [["LEVEL"], ["WHAT"]])
        kept = load_with_gap(0.15)
        self.assertEqual([[w["word"] for w in b["words"]] for b in kept], [["LEVEL", "WHAT"]])

    def test_finish_blocks_splits_when_snap_opens_a_gap(self):
        import render_subtitles as rs

        blocks = [
            {
                "bloc_start": 0.0,
                "bloc_end": 1.0,
                "words": [
                    {"word": "LEVEL", "start": 0.0, "end": 0.4, "line_index": 0},
                    {"word": "WHAT", "start": 0.4, "end": 0.8, "line_index": 0},
                ],
            }
        ]

        def finish_with_gap(gap: float):
            def fake_activity(*_a, **_k):
                return (np.ones(4, dtype=bool), 0.05)

            def fake_snap(bl, *_a, **_k):
                bl[0]["words"][0]["end"] = 0.0
                bl[0]["words"][1]["start"] = gap
                bl[0]["words"][1]["end"] = gap + 0.4
                bl[0]["bloc_end"] = gap + 0.4

            orig_activity = rs.compute_voice_activity
            orig_snap = rs.snap_blocks_to_voice
            rs.compute_voice_activity = fake_activity
            rs.snap_blocks_to_voice = fake_snap
            try:
                return rs._finish_blocks(blocks, 0.0, 2.0, os.path.abspath(__file__))
            finally:
                rs.compute_voice_activity = orig_activity
                rs.snap_blocks_to_voice = orig_snap

        split = finish_with_gap(0.5)
        self.assertEqual([[w["word"] for w in b["words"]] for b in split], [["LEVEL"], ["WHAT"]])
        self.assertLess(split[0]["bloc_end"], split[1]["bloc_start"])

        kept = finish_with_gap(0.15)
        self.assertEqual([[w["word"] for w in b["words"]] for b in kept], [["LEVEL", "WHAT"]])

    def test_generate_ass_has_dialogue(self):
        blocks = [
            {
                "bloc_start": 0.0,
                "bloc_end": 1.2,
                "words": [
                    {"word": "hello", "start": 0.0, "end": 0.5},
                    {"word": "world", "start": 0.5, "end": 1.0},
                ],
            }
        ]
        font = "fonts/Anton-Regular.ttf"
        text = fb.generate_ass(
            blocks, 2.0, 1080, 1920, "karaoke", font, hook_text="HOOK"
        )
        self.assertIn("Dialogue:", text)
        self.assertIn("HOOK", text)
        self.assertIn("hello", text.lower())

    def test_ass_karaoke_fontsize_matches_pillow(self):
        text = fb.generate_ass([], 1.0, 1080, 1920, "karaoke", "fonts/Anton-Regular.ttf")
        self.assertIn("Style: Default,Anton,96,", text)
        split = fb.generate_ass(
            [], 1.0, 1080, 1920, "karaoke", "fonts/Anton-Regular.ttf",
            layout_mode="split_vertical",
        )
        self.assertIn("Style: Default,Anton,80,", split)

    def test_ass_split_captions_stay_above_seam(self):
        import render_subtitles as rs

        layout_fs = fb.ass_layout_fontsize("impact", "split_vertical")
        outline_w = 10
        margin_v = fb.ass_split_margin_v(1920, layout_fs, outline_w)
        line_h = max(layout_fs + 8, int(round(layout_fs * 1.28)))
        bottom = margin_v + 2 * line_h + outline_w
        self.assertLessEqual(bottom, rs.SPLIT_TOP_H)
        split = fb.generate_ass(
            [], 1.0, 1080, 1920, "impact", "fonts/Anton-Regular.ttf",
            layout_mode="split_vertical",
        )
        side = fb.ass_side_margin("impact")
        self.assertIn(f",8,{side},{side},{margin_v},1", split)

    def test_pillow_split_captions_stay_above_seam(self):
        import render_subtitles as rs

        content_h = 2 * int(round(96 * 1.28)) + 10
        y = rs._safe_y_base(1920, content_h, "split_vertical")
        self.assertLessEqual(y + content_h, rs.SPLIT_TOP_H)

    def test_mono_seed_locks_one_seated_face_not_table_gap(self):
        import render_subtitles as rs

        seed = rs.mono_seed_from_face_positions(
            [
                {"cx": 0.16, "cy": 0.44, "area": 0.006},
                {"cx": 0.83, "cy": 0.45, "area": 0.005},
            ]
        )
        self.assertIsNotNone(seed)
        self.assertAlmostEqual(seed[0], 0.16, places=2)
        x, _y, w, _h = fb.mono_crop_rect(1920, 1080, 1080, 1920, seed[0], seed[1], 1.24)
        other = 0.83 * 1920
        self.assertTrue(other < x or other > x + w)

    def test_mono_seed_prefers_eyed_face_on_ots(self):
        import render_subtitles as rs

        seed = rs.mono_seed_from_face_positions(
            [
                {"cx": 0.22, "cy": 0.42, "area": 0.008, "has_eyes": True},
                {"cx": 0.78, "cy": 0.44, "area": 0.012, "has_eyes": False},
            ]
        )
        self.assertIsNotNone(seed)
        self.assertAlmostEqual(seed[0], 0.22, places=2)

    def test_split_clean_rejects_legs_and_ots(self):
        import render_subtitles as rs

        skin = rs.SPLIT_CLEAN_MIN_SKIN + 0.2
        two_heads = rs.split_clean_from_faces(
            [
                (0.18, 0.42, 0.01, True),
                (0.82, 0.44, 0.009, True),
            ],
            skin_left=skin,
            skin_right=skin,
        )
        self.assertTrue(two_heads.clean)
        self.assertEqual(two_heads.reason, "wide_table")

        legs = rs.split_clean_from_faces(
            [
                (0.20, 0.42, 0.01, True),
                (0.80, 0.78, 0.009, True),
            ],
            skin_left=skin,
            skin_right=skin,
        )
        self.assertFalse(legs.clean)
        self.assertEqual(legs.reason, "ots_back")

        ots = rs.split_clean_from_faces(
            [
                (0.22, 0.40, 0.01, True),
                (0.78, 0.42, 0.009, False),
            ],
            skin_left=skin,
            skin_right=skin,
        )
        self.assertTrue(ots.clean)
        self.assertEqual(ots.reason, "wide_table")

        profiles = rs.split_clean_from_faces(
            [
                (0.16, 0.43, 0.008, False),
                (0.84, 0.44, 0.007, False),
            ],
            skin_left=skin,
            skin_right=skin,
        )
        self.assertTrue(profiles.clean)
        self.assertEqual(profiles.reason, "wide_table")

        three = rs.split_clean_from_faces(
            [
                (0.08, 0.78, 0.006, True),
                (0.22, 0.41, 0.01, True),
                (0.80, 0.43, 0.009, True),
            ],
            skin_left=skin,
            skin_right=skin,
        )
        self.assertTrue(three.clean)
        self.assertAlmostEqual(three.left[0], 0.22, places=2)
        self.assertAlmostEqual(three.right[0], 0.80, places=2)

    def test_mono_lock_ease_defaults_off(self):
        import render_subtitles as rs
        import os

        prev = os.environ.pop("MONO_LOCK_EASE", None)
        try:
            self.assertFalse(rs._env_flag_on("MONO_LOCK_EASE", False))
        finally:
            if prev is not None:
                os.environ["MONO_LOCK_EASE"] = prev

    def test_center_crop_slices_both_people_on_wide_table(self):
        x, _y, w, _h = fb.mono_crop_rect(1920, 1080, 1080, 1920, 0.5, 0.36, 1.24)
        self.assertLess(0.16 * 1920, x)
        self.assertGreater(0.83 * 1920, x + w)

    def test_split_zoom_pulls_back_near_source_edge(self):
        import render_subtitles as rs

        edge = rs.split_shared_zoom(0.12, 0.88)
        mid = rs.split_shared_zoom(0.35, 0.65)
        self.assertLess(edge, mid)
        self.assertAlmostEqual(edge, rs.SPLIT_FACE_ZOOM_MIN)

    def test_ass_impact_fontsize_matches_pillow(self):
        self.assertEqual(fb.ass_layout_fontsize("impact", "normal"), 132)
        self.assertEqual(fb.ass_layout_fontsize("impact", "split_vertical"), 96)
        mono_fs = fb.ass_fontsize_for_style("impact", "normal")
        split_fs = fb.ass_fontsize_for_style("impact", "split_vertical")
        self.assertEqual(mono_fs, 132)
        self.assertEqual(split_fs, 96)
        self.assertEqual(mono_fs, fb.ass_impact_fontsize("normal"))
        text = fb.generate_ass([], 1.0, 1080, 1920, "impact", "fonts/Anton-Regular.ttf")
        self.assertIn(f"Style: Default,Anton,{mono_fs},", text)
        self.assertIn(",0,0,0,0,100,100,0,0,1,10,2,", text)
        self.assertIn("WrapStyle: 2", text)
        split = fb.generate_ass(
            [], 1.0, 1080, 1920, "impact", "fonts/Anton-Regular.ttf",
            layout_mode="split_vertical",
        )
        self.assertIn(f"Style: Default,Anton,{split_fs},", split)

    def test_ass_impact_wraps_and_shrinks_like_pillow(self):
        import render_subtitles as rs

        font = rs._resolve_font_path(None)
        blocks = [
            {
                "bloc_start": 0.0,
                "bloc_end": 1.0,
                "words": [
                    {"word": "MANIPULATION", "start": 0.0, "end": 0.4},
                    {"word": "L'INTÉRESSANTE", "start": 0.4, "end": 0.9},
                ],
            }
        ]
        text = fb.generate_ass(blocks, 1.0, 1080, 1920, "impact", font)
        self.assertIn(r"\N", text)
        fs, _lines, _, _ = rs.impact_fit_layout(
            1080, blocks[0]["words"], "normal", font
        )
        self.assertGreaterEqual(fs, 76)
        self.assertLessEqual(fs, 100)
        self.assertIn(f"\\fs{fs}", text)
        self.assertNotIn("\\fs226", text)
        self.assertNotIn("Style: Default,Anton,226,", text)

    def test_ass_impact_stacks_words_with_n(self):
        blocks = [
            {
                "bloc_start": 0.0,
                "bloc_end": 1.0,
                "words": [
                    {"word": "ET", "start": 0.0, "end": 0.4},
                    {"word": "DONC,", "start": 0.4, "end": 0.9},
                ],
            }
        ]
        text = fb.generate_ass(
            blocks, 1.0, 1080, 1920, "impact", "fonts/Anton-Regular.ttf"
        )
        self.assertIn("DONC,", text)
        self.assertIn("\\fs", text)
        karaoke = fb.generate_ass(
            blocks, 1.0, 1080, 1920, "karaoke", "fonts/Anton-Regular.ttf"
        )
        self.assertNotIn(r"\N", karaoke)

    def test_ass_impact_active_word_pops(self):
        blocks = [
            {
                "bloc_start": 0.0,
                "bloc_end": 1.0,
                "words": [
                    {"word": "DES", "start": 0.0, "end": 0.4},
                    {"word": "TECHNOLOGIES", "start": 0.4, "end": 0.9},
                ],
            }
        ]
        text = fb.generate_ass(
            blocks, 1.0, 1080, 1920, "impact", "fonts/Anton-Regular.ttf"
        )
        self.assertIn("\\fscx114\\fscy114", text)
        self.assertIn("TECHNOLOGIES", text)

    def test_hybrid_mono_run_keeps_full_karaoke_size(self):
        self.assertEqual(fb.caption_layout_for_run(False), "normal")
        self.assertEqual(fb.caption_layout_for_run(True), "split_vertical")
        self.assertEqual(fb.ass_karaoke_fontsize("normal"), 96)
        self.assertEqual(fb.ass_karaoke_fontsize("split_vertical"), 80)
        mono = fb.generate_ass(
            [], 1.0, 1080, 1920, "karaoke", "fonts/Anton-Regular.ttf",
            layout_mode=fb.caption_layout_for_run(False),
        )
        split = fb.generate_ass(
            [], 1.0, 1080, 1920, "karaoke", "fonts/Anton-Regular.ttf",
            layout_mode=fb.caption_layout_for_run(True),
        )
        self.assertIn("Style: Default,Anton,96,", mono)
        self.assertIn("Style: Default,Anton,80,", split)

    def test_concat_file_line_uses_single_quotes(self):
        line = fb.concat_file_line("/tmp/clip part.mp4")
        self.assertTrue(line.startswith("file '"))
        self.assertTrue(line.endswith("'\n"))
        self.assertNotIn('"', line)
        self.assertIn("/tmp/clip part.mp4", line)


class TestFfmpegTimeout(unittest.TestCase):
    def test_timeout_from_t_flag(self):
        cmd = ["ffmpeg", "-ss", "12.5", "-t", "10", "-i", "/tmp/src.mp4"]
        self.assertEqual(fb._ffmpeg_timeout_sec(cmd), 180.0)

    def test_timeout_floor_and_cap(self):
        self.assertEqual(fb._ffmpeg_timeout_sec(["ffmpeg", "-t", "0.1"]), 180.0)
        self.assertEqual(fb._ffmpeg_timeout_sec(["ffmpeg", "-t", "90"]), 600.0)
        self.assertAlmostEqual(fb._ffmpeg_timeout_sec(["ffmpeg", "-t", "83.9"]), 563.4, places=1)

    def test_timeout_concat_without_t(self):
        cmd = ["ffmpeg", "-f", "concat", "-i", "list.txt", "-c", "copy", "out.mp4"]
        self.assertEqual(fb._ffmpeg_timeout_sec(cmd), 180.0)

    def test_stall_window(self):
        self.assertEqual(fb._ffmpeg_stall_sec(125.0), 25.0)
        self.assertEqual(fb._ffmpeg_stall_sec(45.8), 12.0)
        self.assertTrue(fb._ffmpeg_is_stream_copy(["ffmpeg", "-c", "copy", "out.mp4"]))
        self.assertFalse(fb._ffmpeg_is_stream_copy(["ffmpeg", "-c:v", "libx264"]))


class TestSendcmdPanOnly(unittest.TestCase):
    def test_sendcmd_emits_xy_not_wh(self):
        cx = np.linspace(0.35, 0.65, 48)
        cy = np.full(48, 0.36)
        zoom = np.linspace(1.0, 1.4, 48)
        text = fb.build_sendcmd(
            2.0, 1920, 1080, 1080, 1920, cx, cy, zoom, 24.0, 1.24, 0.36
        )
        self.assertIn("crop x ", text)
        self.assertIn("crop y ", text)
        self.assertNotIn("crop w ", text)
        self.assertNotIn("crop h ", text)

    def test_talk_crop_vf_optional_sendcmd(self):
        static = fb._talk_crop_vf(
            24.0, 490, 870, 714, 74, 1080, 1920, "format=yuv420p[pre]", "[pre]null[vout]"
        )
        self.assertNotIn("sendcmd", static)
        sending = fb._talk_crop_vf(
            24.0, 490, 870, 714, 74, 1080, 1920, "format=yuv420p[pre]", "[pre]null[vout]",
            cmd_path="/tmp/crop.txt",
        )
        self.assertIn("sendcmd=f=", sending)

    def test_sendcmd_emits_transition_on_exact_output_frame(self):
        # The second crop begins at output frame 5 (5 / 24s), not at the next
        # old 250ms polling tick.
        cx = np.array([0.25] * 5 + [0.75] * 10, dtype=np.float32)
        cy = np.full(len(cx), 0.36, dtype=np.float32)
        text = fb.build_sendcmd(
            len(cx) / 24.0,
            1920,
            1080,
            1080,
            1920,
            cx,
            cy,
            None,
            24.0,
            1.24,
            0.36,
            out_fps=24.0,
            track_is_output=True,
        )
        self.assertIn(f"{5 / 24.0:.6f} crop x ", text)

    def test_initial_crop_uses_first_timeline_frame(self):
        cx = np.array([0.74, 0.74], dtype=np.float32)
        cy = np.array([0.34, 0.34], dtype=np.float32)
        x, _y, _w, _h = fb.track_crop_at_output_frame(
            1920, 1080, 1080, 1920, cx, cy, None, 1.24, 0.36,
            out_fps=24.0, track_is_output=True,
        )
        center_x, _center_y, _center_w, _center_h = fb.mono_crop_rect(
            1920, 1080, 1080, 1920, 0.5, 0.36, 1.24, 0.36
        )
        self.assertNotEqual(x, center_x)

    def test_mono_crop_trace_links_track_crop_and_ffmpeg_command(self):
        cx = np.full(400, 0.74, dtype=np.float32)
        cy = np.full(400, 0.34, dtype=np.float32)
        stream = StringIO()
        with redirect_stdout(stream):
            fb.log_mono_crop_trace(
                clip_start=12.0,
                run_start_frame=0,
                run_end_frame=400,
                src_w=1920,
                src_h=1080,
                out_w=1080,
                out_h=1920,
                out_fps=24.0,
                fps_src=30.0,
                cx=cx,
                cy=cy,
                zoom=None,
                default_zoom=1.24,
                eye_y=0.36,
                lock_w=784,
                lock_h=1080,
            )
        trace = stream.getvalue()
        self.assertIn("output_frame=360", trace)
        self.assertIn("source_frame=810", trace)
        self.assertIn("track_target=(0.7400,0.3400)", trace)
        self.assertIn("calculated_crop=", trace)
        self.assertIn("applied_crop=", trace)
        self.assertIn("ffmpeg_sendcmd=", trace)

    def test_hang_classifier(self):
        self.assertTrue(fb._is_ffmpeg_hang(RuntimeError("main ffmpeg stalled (no frame progress for 25s)")))
        self.assertTrue(fb._is_ffmpeg_hang(RuntimeError("main ffmpeg timeout after 480s")))
        self.assertFalse(fb._is_ffmpeg_hang(RuntimeError("main ffmpeg exit 1: error")))


class TestFfmpegEncodeCmd(unittest.TestCase):
    def test_ss_is_scoped_to_video_and_duration_after_all_inputs(self):
        cmd = fb.build_ffmpeg_encode_cmd(
            "/tmp/src.mp4",
            12.5,
            8.0,
            "/tmp/out.mp4",
            "[0:v]format=yuv420p[pre];[pre]null[vout]",
            "[vout]",
            extra_inputs=["-loop", "1", "-i", "/tmp/hook.png"],
            out_fps=24.0,
        )
        i_ss = cmd.index("-ss")
        i_t = cmd.index("-t")
        i_video = cmd.index("-i")
        self.assertEqual(cmd[i_video + 1], "/tmp/src.mp4")
        self.assertEqual(cmd[i_ss + 1], "12.500")
        self.assertEqual(cmd[i_t + 1], "8.000000")
        self.assertEqual(i_ss + 2, i_video)
        self.assertLess(i_video, cmd.index("/tmp/hook.png"))
        self.assertGreater(i_t, cmd.index("/tmp/hook.png"))
        self.assertNotIn("trim=start", " ".join(cmd))

    def test_clean_maps_both_pads_in_one_command(self):
        cmd = fb.build_ffmpeg_encode_cmd(
            "/tmp/src.mp4",
            56.0,
            63.0,
            "/tmp/out.mp4",
            "[pre]split=2[ps][clean];[ps]null[vout]",
            "[vout]",
            clean_output="/tmp/clean.mp4",
            clean_map="[clean]",
        )
        self.assertEqual(cmd.count("-map"), 4)
        self.assertIn("[vout]", cmd)
        self.assertIn("[clean]", cmd)
        self.assertEqual(cmd[-1], "/tmp/clean.mp4")
        self.assertIn("/tmp/out.mp4", cmd)
        self.assertEqual(cmd.count("ffmpeg"), 1)

    def test_accurate_seek_is_scoped_to_the_video_input(self):
        cmd = fb.build_ffmpeg_encode_cmd(
            "/tmp/src.mp4", 12.5, 8.0, "/tmp/out.mp4",
            "[0:v]null[vout]", "[vout]", seek_mode="accurate",
        )
        i_video = cmd.index("-i")
        i_ss = cmd.index("-ss")
        self.assertLess(i_ss, i_video)
        self.assertEqual(cmd[i_ss + 1], "12.500000")
        self.assertIn("-accurate_seek", cmd)
        self.assertGreater(cmd.index("-t"), i_video)


    def test_encode_filter_seek_and_clean_without_subtitles(self):
        """Prod graph: one ffmpeg, -ss before -i, both [vout] and [clean] mapped."""
        with tempfile.TemporaryDirectory(prefix="ffburn-map-") as tmp:
            src = os.path.join(tmp, "src.mp4")
            out = os.path.join(tmp, "out.mp4")
            clean = os.path.join(tmp, "clean.mp4")
            mk = subprocess.run(
                [
                    "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                    "-f", "lavfi", "-i", "testsrc=size=640x360:rate=24:duration=4",
                    "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast",
                    "-c:a", "aac", "-shortest", src,
                ],
                capture_output=True,
            )
            if mk.returncode != 0:
                self.skipTest("ffmpeg cannot encode testsrc")
            vf = (
                "[0:v]setpts=PTS-STARTPTS,fps=24,format=yuv420p,"
                "split=2[vout][clean]"
            )
            fb._encode_filter(
                src, 1.0, 2.0, out, vf, "[vout]",
                clean_output=clean,
                clean_map="[clean]",
                out_fps=24.0,
            )
            self.assertTrue(os.path.isfile(out), "main output missing")
            self.assertTrue(os.path.isfile(clean), "clean output missing")
            self.assertGreater(os.path.getsize(out), 4000)
            self.assertGreater(os.path.getsize(clean), 4000)

    def test_orphan_clean_pad_fails_like_prod(self):
        """Old _encode_filter mapped only [vout] while split still emitted [clean]."""
        with tempfile.TemporaryDirectory(prefix="ffburn-orphan-") as tmp:
            src = os.path.join(tmp, "src.mp4")
            out = os.path.join(tmp, "out.mp4")
            mk = subprocess.run(
                [
                    "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                    "-f", "lavfi", "-i", "testsrc=size=320x240:rate=24:duration=1",
                    "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast",
                    "-c:a", "aac", "-shortest", src,
                ],
                capture_output=True,
            )
            if mk.returncode != 0:
                self.skipTest("ffmpeg cannot encode testsrc")
            vf = "[0:v]format=yuv420p,split=2[vout][clean]"
            cmd = fb.build_ffmpeg_encode_cmd(
                src, 0.0, 0.5, out, vf, "[vout]", out_fps=24.0,
            )
            proc = subprocess.run(cmd, capture_output=True)
            err = (proc.stderr or b"").decode("utf-8", errors="replace")
            self.assertNotEqual(proc.returncode, 0)
            self.assertIn("unconnected", err.lower())

    def test_hook_overlay_and_clean_dual_map(self):
        """Paid path with pillow hook: extras after video -i, both pads mapped."""
        with tempfile.TemporaryDirectory(prefix="ffburn-hook-") as tmp:
            src = os.path.join(tmp, "src.mp4")
            png = os.path.join(tmp, "hook.png")
            out = os.path.join(tmp, "out.mp4")
            clean = os.path.join(tmp, "clean.mp4")
            mk = subprocess.run(
                [
                    "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                    "-f", "lavfi", "-i", "testsrc=size=640x360:rate=24:duration=3",
                    "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast",
                    "-c:a", "aac", "-shortest", src,
                ],
                capture_output=True,
            )
            if mk.returncode != 0:
                self.skipTest("ffmpeg cannot encode testsrc")
            png_mk = subprocess.run(
                [
                    "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                    "-f", "lavfi", "-i", "color=c=red:s=640x360:d=1",
                    "-frames:v", "1", png,
                ],
                capture_output=True,
            )
            if png_mk.returncode != 0:
                self.skipTest("ffmpeg cannot write hook png")
            vf = (
                "[0:v]setpts=PTS-STARTPTS,fps=24,format=yuv420p,split=2[ps][clean];"
                "[ps]null[sc];[sc][1:v]overlay=0:0:format=auto:enable='between(t,0.000,0.400)'[vout]"
            )
            fb._encode_filter(
                src, 0.5, 1.5, out, vf, "[vout]",
                extra_inputs=["-loop", "1", "-i", png],
                clean_output=clean,
                clean_map="[clean]",
                out_fps=24.0,
            )
            self.assertTrue(os.path.isfile(out) and os.path.getsize(out) > 4000)
            self.assertTrue(os.path.isfile(clean) and os.path.getsize(clean) > 4000)


class TestFfmpegBurnEncode(unittest.TestCase):
    def test_talk_pass2_encodes_short_clip(self):
        # Pillow lab concat — no libass required.
        root = os.path.dirname(os.path.abspath(__file__))
        font = os.path.join(root, "fonts", "Anton-Regular.ttf")
        if not os.path.isfile(font):
            self.skipTest("Anton font missing")
        with tempfile.TemporaryDirectory(prefix="ffburn-smk-") as tmp:
            src = os.path.join(tmp, "src.mp4")
            out = os.path.join(tmp, "out.mp4")
            mk = subprocess.run(
                [
                    "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                    "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=24:duration=2",
                    "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast",
                    "-c:a", "aac", "-shortest", src,
                ],
                capture_output=True,
            )
            if mk.returncode != 0:
                self.skipTest("ffmpeg cannot encode testsrc")
            blocks = [
                {
                    "bloc_start": 0.0,
                    "bloc_end": 1.5,
                    "words": [
                        {"word": "hello", "start": 0.0, "end": 0.6},
                        {"word": "world", "start": 0.6, "end": 1.2},
                    ],
                }
            ]
            result = fb.render_talk_pass2(
                video_path=src,
                start=0.0,
                duration=2.0,
                output_path=out,
                blocks=blocks,
                style="karaoke",
                font_path=font,
                out_w=720,
                out_h=1280,
                out_fps=24.0,
                src_w=1280,
                src_h=720,
                fps_src=24.0,
                cx_smooth=None,
                cy_smooth=None,
                zoom_smooth=None,
                layout_split_mask=None,
                split_lock_top=None,
                split_lock_bot=None,
                face_positions=[],
                hook_text="HOOK",
                hook_duration=0.8,
                clean_output=None,
                work_dir=tmp,
            )
            self.assertTrue(os.path.isfile(out), "pass2 output missing")
            self.assertGreater(os.path.getsize(out), 8000)
            self.assertEqual(result["effective_mode"], "normal")

    def test_talk_pass2_seek_and_clean_output(self):
        # Pillow lab concat — no libass required.
        root = os.path.dirname(os.path.abspath(__file__))
        font = os.path.join(root, "fonts", "Anton-Regular.ttf")
        if not os.path.isfile(font):
            self.skipTest("Anton font missing")
        with tempfile.TemporaryDirectory(prefix="ffburn-clean-") as tmp:
            src = os.path.join(tmp, "src.mp4")
            out = os.path.join(tmp, "out.mp4")
            clean = os.path.join(tmp, "clean.mp4")
            mk = subprocess.run(
                [
                    "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                    "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=24:duration=4",
                    "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast",
                    "-c:a", "aac", "-shortest", src,
                ],
                capture_output=True,
            )
            if mk.returncode != 0:
                self.skipTest("ffmpeg cannot encode testsrc")
            blocks = [
                {
                    "bloc_start": 0.0,
                    "bloc_end": 1.2,
                    "words": [
                        {"word": "hello", "start": 0.0, "end": 0.5},
                        {"word": "world", "start": 0.5, "end": 1.0},
                    ],
                }
            ]
            result = fb.render_talk_pass2(
                video_path=src,
                start=1.0,
                duration=2.0,
                output_path=out,
                blocks=blocks,
                style="karaoke",
                font_path=font,
                out_w=720,
                out_h=1280,
                out_fps=24.0,
                src_w=1280,
                src_h=720,
                fps_src=24.0,
                cx_smooth=None,
                cy_smooth=None,
                zoom_smooth=None,
                layout_split_mask=None,
                split_lock_top=None,
                split_lock_bot=None,
                face_positions=[],
                hook_text="HOOK",
                hook_duration=0.5,
                clean_output=clean,
                work_dir=tmp,
            )
            self.assertTrue(os.path.isfile(out), "pass2 output missing")
            self.assertTrue(os.path.isfile(clean), "clean output missing")
            self.assertGreater(os.path.getsize(out), 8000)
            self.assertGreater(os.path.getsize(clean), 8000)
            self.assertEqual(result["effective_mode"], "normal")

    def test_talk_pass2_split_clean_is_not_burned_copy(self):
        """Split runs must encode a overlay-free clean, not copy the burned concat."""
        import filecmp

        root = os.path.dirname(os.path.abspath(__file__))
        font = os.path.join(root, "fonts", "Anton-Regular.ttf")
        if not os.path.isfile(font):
            self.skipTest("Anton font missing")
        with tempfile.TemporaryDirectory(prefix="ffburn-split-clean-") as tmp:
            src = os.path.join(tmp, "src.mp4")
            out = os.path.join(tmp, "out.mp4")
            clean = os.path.join(tmp, "clean.mp4")
            mk = subprocess.run(
                [
                    "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                    "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=24:duration=3",
                    "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast",
                    "-c:a", "aac", "-shortest", src,
                ],
                capture_output=True,
            )
            if mk.returncode != 0:
                self.skipTest("ffmpeg cannot encode testsrc")
            blocks = [
                {
                    "bloc_start": 0.0,
                    "bloc_end": 1.4,
                    "words": [
                        {"word": "hello", "start": 0.0, "end": 0.6},
                        {"word": "world", "start": 0.6, "end": 1.2},
                    ],
                }
            ]
            mask = np.ones(48, dtype=bool)
            result = fb.render_talk_pass2(
                video_path=src,
                start=0.0,
                duration=2.0,
                output_path=out,
                blocks=blocks,
                style="karaoke",
                font_path=font,
                out_w=720,
                out_h=1280,
                out_fps=24.0,
                src_w=1280,
                src_h=720,
                fps_src=24.0,
                cx_smooth=None,
                cy_smooth=None,
                zoom_smooth=None,
                layout_split_mask=mask,
                split_lock_top=None,
                split_lock_bot=None,
                face_positions=[
                    {"cx": 0.35, "cy": 0.32},
                    {"cx": 0.65, "cy": 0.32},
                ],
                hook_text="HOOK TITLE CARD",
                hook_duration=0.8,
                clean_output=clean,
                work_dir=tmp,
            )
            self.assertTrue(os.path.isfile(out), "pass2 output missing")
            self.assertTrue(os.path.isfile(clean), "clean output missing")
            self.assertGreater(os.path.getsize(out), 8000)
            self.assertGreater(os.path.getsize(clean), 8000)
            self.assertEqual(result["effective_mode"], "split_vertical")
            for rendered in (out, clean):
                probe = subprocess.run(
                    [
                        "ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0",
                        "-show_entries", "stream=nb_read_frames", "-of", "default=nokey=1:noprint_wrappers=1",
                        rendered,
                    ],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                self.assertEqual(probe.returncode, 0, probe.stderr)
                self.assertEqual(
                    int(probe.stdout.strip()),
                    48,
                    "concat must preserve the 48-frame, 2-second camera timeline",
                )
            self.assertFalse(
                filecmp.cmp(out, clean, shallow=False),
                "clean must not be a byte copy of the burned split render",
            )

    def test_hybrid_transitions_keep_global_24fps_frame_boundaries(self):
        """30/24/60fps sources use one 24fps timeline without run-local resets."""
        root = os.path.dirname(os.path.abspath(__file__))
        font = os.path.join(root, "fonts", "Anton-Regular.ttf")
        if not os.path.isfile(font):
            self.skipTest("Anton font missing")

        with tempfile.TemporaryDirectory(prefix="ffburn-hybrid-frames-") as tmp:
            for source_fps in (24, 30, 60):
                with self.subTest(source_fps=source_fps):
                    src = os.path.join(tmp, f"source-{source_fps}.mp4")
                    out = os.path.join(tmp, f"out-{source_fps}.mp4")
                    clean = os.path.join(tmp, f"clean-{source_fps}.mp4")
                    # Left/right panels remain visually distinct: an exact
                    # split boundary must therefore show red on top and blue
                    # below on its *first* frame, while the following mono
                    # boundary is already the right-hand (blue) crop.
                    mk = subprocess.run(
                        [
                            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                            "-f", "lavfi", "-i", f"color=red:size=640x720:rate={source_fps}:duration=4",
                            "-f", "lavfi", "-i", f"color=blue:size=640x720:rate={source_fps}:duration=4",
                            "-filter_complex", "[0:v][1:v]hstack=inputs=2",
                            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast", src,
                        ],
                        capture_output=True,
                    )
                    if mk.returncode != 0:
                        self.skipTest("ffmpeg cannot encode synthetic hybrid source")
                    mask = np.array([False] * 24 + [True] * 24 + [False] * 24 + [True] * 24)
                    cx = np.array([0.25] * 48 + [0.75] * 48, dtype=np.float32)
                    cy = np.full(96, 0.36, dtype=np.float32)
                    locks_top = np.tile(np.array([0.25, 0.36]), (96, 1))
                    locks_bottom = np.tile(np.array([0.75, 0.36]), (96, 1))
                    # One paid-sized result verifies the product export rule;
                    # the other source cadence variants stay smaller so this
                    # regression suite remains fast.
                    out_w, out_h = (1080, 1920) if source_fps == 30 else (360, 640)
                    result = fb.render_talk_pass2(
                        video_path=src, start=0.0, duration=4.0,
                        output_path=out, clean_output=clean, blocks=[], style="karaoke",
                        font_path=font, out_w=out_w, out_h=out_h, out_fps=24.0,
                        src_w=1280, src_h=720, fps_src=float(source_fps),
                        cx_smooth=cx, cy_smooth=cy, zoom_smooth=None,
                        layout_split_mask=mask, split_lock_top=locks_top,
                        split_lock_bot=locks_bottom,
                        face_positions=[{"cx": 0.25, "cy": 0.36}, {"cx": 0.75, "cy": 0.36}],
                        hook_text=None, hook_duration=0.8, work_dir=tmp,
                    )
                    self.assertEqual(result["total_frames"], 96)
                    for rendered in (out, clean):
                        probe = subprocess.run(
                            [
                                "ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0",
                                "-show_entries", "stream=width,height,r_frame_rate,nb_read_frames",
                                "-of", "default=nokey=1:noprint_wrappers=1", rendered,
                            ], capture_output=True, text=True, check=False,
                        )
                        self.assertEqual(probe.returncode, 0, probe.stderr)
                        self.assertEqual(probe.stdout.splitlines(), [str(out_w), str(out_h), "24/1", "96"])

                    cap = cv2.VideoCapture(clean)
                    frames = []
                    while True:
                        ok, frame = cap.read()
                        if not ok:
                            break
                        frames.append(frame)
                    cap.release()
                    self.assertEqual(len(frames), 96)
                    # Frame 24 starts split: top=left/red, bottom=right/blue.
                    split_first = frames[24]
                    self.assertGreater(int(split_first[out_h // 4, out_w // 2, 2]), 140)
                    self.assertGreater(int(split_first[3 * out_h // 4, out_w // 2, 0]), 100)
                    # Frame 48 starts mono again and is already the new
                    # right-side crop; no centred/default transition frame.
                    mono_first = frames[48]
                    self.assertGreater(int(mono_first[out_h // 2, out_w // 2, 0]), 100)
                    self.assertLess(int(mono_first[out_h // 2, out_w // 2, 2]), 80)


class TestPillowLabCaptions(unittest.TestCase):
    def _font(self) -> str:
        root = os.path.dirname(os.path.abspath(__file__))
        font = os.path.join(root, "fonts", "Anton-Regular.ttf")
        if not os.path.isfile(font):
            self.skipTest("Anton font missing")
        return font

    def _blocks(self):
        return [
            {
                "bloc_start": 0.0,
                "bloc_end": 1.2,
                "words": [
                    {"word": "MASTER", "start": 0.0, "end": 0.5},
                    {"word": "OU", "start": 0.5, "end": 0.8},
                    {"word": "UN", "start": 0.8, "end": 1.1},
                ],
            }
        ]

    def test_caption_stage_uses_pillow_concat_not_ass(self):
        font = self._font()
        with tempfile.TemporaryDirectory(prefix="ffcap-") as tmp:
            graph, extra, map_v, clean = fb._caption_stage(
                tmp,
                duration=1.4,
                out_w=720,
                out_h=1280,
                style="karaoke",
                font_path=font,
                fonts_dir=os.path.dirname(font),
                blocks=self._blocks(),
                hook_text=None,
                hook_duration=0.0,
                layout_mode="stream_stack",
                want_clean=False,
            )
        self.assertEqual(map_v, "[vout]")
        self.assertIsNone(clean)
        self.assertNotIn("subtitles=", graph)
        self.assertIn("overlay=", graph)
        self.assertIn("concat", extra)
        self.assertIn("-f", extra)

    def test_caption_stage_overlay_y_shifts_onto_square(self):
        font = self._font()
        with tempfile.TemporaryDirectory(prefix="ffcap-y-") as tmp:
            graph, extra, map_v, _clean = fb._caption_stage(
                tmp,
                duration=1.4,
                out_w=1080,
                out_h=1080,
                style="neon",
                font_path=font,
                fonts_dir=os.path.dirname(font),
                blocks=self._blocks(),
                hook_text="HOOK",
                hook_duration=0.6,
                layout_mode="normal",
                want_clean=False,
                overlay_y=420,
            )
        self.assertEqual(map_v, "[vout]")
        self.assertIn("overlay=0:420", graph)

    def test_caption_stage_caption_dy_shifts_overlay(self):
        font = self._font()
        with tempfile.TemporaryDirectory(prefix="ffcap-dy-") as tmp:
            graph, extra, map_v, _clean = fb._caption_stage(
                tmp,
                duration=1.4,
                out_w=1080,
                out_h=1920,
                style="neon",
                font_path=font,
                fonts_dir=os.path.dirname(font),
                blocks=self._blocks(),
                hook_text="HOOK",
                hook_duration=0.6,
                layout_mode="normal",
                want_clean=False,
                overlay_y=0,
                caption_dy=80,
                hook_dy=-40,
            )
        self.assertEqual(map_v, "[vout]")
        self.assertIn("overlay=0:-40", graph)
        self.assertRegex(graph, r"overlay=\d+:\d+")
        m = re.search(r"\[pre\]\[cap\]overlay=(\d+):(\d+)", graph)
        self.assertIsNotNone(m)
        self.assertGreaterEqual(int(m.group(2)), 80)

    def test_offset_y_px_clamps(self):
        self.assertEqual(fb.offset_y_px(0.1, 1920), 192)
        self.assertEqual(fb.offset_y_px(1.0, 1920), int(round(0.28 * 1920)))
        self.assertEqual(fb.offset_y_px(-1.0, 1080), int(round(-0.28 * 1080)))

    def test_caption_stage_hook_and_clean_keep_overlay(self):
        font = self._font()
        with tempfile.TemporaryDirectory(prefix="ffcap-h-") as tmp:
            graph, extra, map_v, clean = fb._caption_stage(
                tmp,
                duration=1.4,
                out_w=720,
                out_h=1280,
                style="neon",
                font_path=font,
                fonts_dir=os.path.dirname(font),
                blocks=self._blocks(),
                hook_text="HOOK",
                hook_duration=0.6,
                layout_mode="normal",
                want_clean=True,
            )
        self.assertEqual(map_v, "[vout]")
        self.assertEqual(clean, "[clean]")
        self.assertNotIn("subtitles=", graph)
        self.assertGreaterEqual(extra.count("-i"), 2)
        self.assertIn("[clean]", graph)
        loop_at = extra.index("-loop")
        self.assertEqual(extra[loop_at + 1], "1")
        self.assertEqual(extra[loop_at + 2], "-t")

    def test_karaoke_lab_png_has_green_pill(self):
        import render_subtitles as rs

        font = self._font()
        bloc = self._blocks()[0]
        arr = rs.render_subtitle_frame(
            1080, 1920, bloc, bloc["words"][0], "karaoke", font,
            layout_mode="stream_stack",
        )
        ys, xs = __import__("numpy").nonzero(arr[:, :, 3] > 40)
        self.assertGreater(ys.size, 200)
        rgb = arr[ys, xs, :3].astype("int16")
        greenish = ((rgb[:, 1] >= 180) & (rgb[:, 0] <= 80) & (rgb[:, 2] <= 180)).sum()
        self.assertGreater(greenish, 80, "karaoke lab frame missing green pill")

    def test_impact_stroke_native_and_fast(self):
        import inspect
        import time
        import render_subtitles as rs

        src = inspect.getsource(rs._draw_outlined_text)
        self.assertIn("stroke_width", src)
        self.assertNotIn("_outline_offsets", src)
        self.assertFalse(hasattr(rs, "_outline_offsets"))

        font = self._font()
        words = [
            {"word": w, "start": i * 0.4, "end": i * 0.4 + 0.35}
            for i, w in enumerate("this may sound preposterous but well".split())
        ]
        blocks = []
        for i in range(0, len(words), 2):
            chunk = words[i : i + 2]
            blocks.append({"words": chunk, "bloc_start": chunk[0]["start"], "bloc_end": chunk[-1]["end"]})
        rs.render_subtitle_frame(
            1080, 1920, blocks[0], blocks[0]["words"][0], "impact", font, layout_mode="normal"
        )
        n = 0
        t0 = time.monotonic()
        for bloc in blocks:
            for w in bloc["words"]:
                rs.render_subtitle_frame(1080, 1920, bloc, w, "impact", font, layout_mode="normal")
                n += 1
        ms_per = (time.monotonic() - t0) * 1000 / max(1, n)
        self.assertLess(ms_per, 50, f"impact karaoke {ms_per:.1f} ms/frame (stroke should be <50)")


class TestVisioSplit(unittest.TestCase):
    def test_classify_visio_large_opposite_faces(self):
        import render_subtitles as rs

        layout = rs.classify_source_layout(
            [
                {"cx": 0.25, "cy": 0.38, "area": 0.055},
                {"cx": 0.75, "cy": 0.40, "area": 0.048},
            ]
        )
        self.assertEqual(layout, "visio")

    def test_classify_wide_table_small_faces_not_visio(self):
        import render_subtitles as rs

        layout = rs.classify_source_layout(
            [
                {"cx": 0.28, "cy": 0.42, "area": 0.012},
                {"cx": 0.72, "cy": 0.44, "area": 0.010},
            ]
        )
        self.assertEqual(layout, "table")

    def test_visio_crop_stays_in_own_tile(self):
        import render_subtitles as rs

        src_w, src_h = 1920, 1080
        out_w, panel_h = 1080, 960
        x, _y, w, _h = rs.visio_tile_crop_rect(
            src_w, src_h, out_w, panel_h, 0.25, 0.38, "left"
        )
        self.assertGreaterEqual(x, 0)
        self.assertLessEqual(x + w, src_w * 0.5 + 1)
        x2, _y2, w2, _h2 = rs.visio_tile_crop_rect(
            src_w, src_h, out_w, panel_h, 0.75, 0.40, "right"
        )
        self.assertGreaterEqual(x2, src_w * 0.5 - 1)
        self.assertLessEqual(x2 + w2, src_w)
        # Guest sitting left-of-center in their tile must not pull Alexis in.
        x3, _y3, w3, _h3 = rs.visio_tile_crop_rect(
            src_w, src_h, out_w, panel_h, 0.52, 0.40, "right"
        )
        self.assertGreaterEqual(x3, src_w * 0.5 - 1)
        self.assertLessEqual(x3 + w3, src_w)

    def test_visio_panel_heights_are_50_50(self):
        import render_subtitles as rs

        top, bot = rs.visio_panel_heights(1920, 0)
        self.assertEqual(top, bot)
        self.assertEqual(top + bot, 1920)
        top_s, bot_s = rs.visio_panel_heights(1920, 4)
        self.assertEqual(top_s, bot_s)
        self.assertEqual(top_s + bot_s + 4, 1920)

    def test_visio_frame_bottom_does_not_include_left_tile(self):
        import render_subtitles as rs

        frame = np.zeros((1080, 1920, 3), dtype=np.uint8)
        frame[:, :960] = (0, 255, 0)
        frame[:, 960:] = (255, 0, 0)
        out = rs.resize_and_crop_visio_frame(
            frame,
            (0.25, 0.40),
            (0.55, 0.40),
            out_w=1080,
            out_h=1920,
            separator_px=0,
        )
        self.assertEqual(out.shape[0], 1920)
        self.assertEqual(out.shape[1], 1080)
        top = out[:960]
        bot = out[960:]
        self.assertGreater(float(top[:, :, 1].mean()), 180)
        self.assertGreater(float(bot[:, :, 0].mean()), 180)
        self.assertLess(float(bot[:, :, 1].mean()), 25)

    def test_visio_captions_use_split_size_and_mid_seam(self):
        import render_subtitles as rs

        self.assertEqual(fb.ass_layout_fontsize("impact", "visio_split"), 96)
        self.assertEqual(fb.caption_layout_for_run(True, "visio_split"), "visio_split")
        content_h = 2 * int(round(96 * 1.28)) + 10
        y = rs._safe_y_base(1920, content_h, "visio_split")
        seam = rs.stacked_seam_y("visio_split", 1920)
        self.assertLessEqual(y + content_h, seam)
        self.assertGreater(seam, 940)
        self.assertLess(seam, 980)
        margin_v = fb.ass_split_margin_v(1920, 96, 10, layout_mode="visio_split")
        line_h = max(96 + 8, int(round(96 * 1.28)))
        bottom = margin_v + 2 * line_h + 10
        self.assertLessEqual(bottom, seam)


if __name__ == "__main__":
    unittest.main()
