import os
import subprocess
import tempfile
import unittest

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

    def test_mask_runs_absorbs_leading_mono_flash(self):
        # 3 frames mono then split — the 0.12s preflight trim that flashed on prod.
        mask = np.array([0, 0, 0] + [1] * 20, dtype=bool)
        runs = fb.mask_runs(mask, out_fps=24.0, min_run_sec=0.35)
        self.assertEqual(len(runs), 1)
        self.assertTrue(runs[0][2])
        self.assertAlmostEqual(runs[0][0], 0.0)

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
        self.assertEqual(fb._ffmpeg_timeout_sec(cmd), 125.0)

    def test_timeout_floor_and_cap(self):
        self.assertAlmostEqual(fb._ffmpeg_timeout_sec(["ffmpeg", "-t", "0.1"]), 45.8)
        self.assertEqual(fb._ffmpeg_timeout_sec(["ffmpeg", "-t", "90"]), 480.0)

    def test_timeout_concat_without_t(self):
        cmd = ["ffmpeg", "-f", "concat", "-i", "list.txt", "-c", "copy", "out.mp4"]
        self.assertEqual(fb._ffmpeg_timeout_sec(cmd), 120.0)


class TestFfmpegEncodeCmd(unittest.TestCase):
    def test_ss_immediately_before_video_input(self):
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
        self.assertEqual(cmd[i_t + 1], "8.000")
        self.assertEqual(i_ss + 2, i_t)
        self.assertEqual(i_t + 2, i_video)
        self.assertLess(i_video, cmd.index("/tmp/hook.png"))
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


if __name__ == "__main__":
    unittest.main()
