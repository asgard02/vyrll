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
        if not fb.ffmpeg_has_subtitles_filter():
            self.skipTest("ffmpeg has no libass/subtitles filter")
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
        if not fb.ffmpeg_has_subtitles_filter():
            self.skipTest("ffmpeg has no libass/subtitles filter")
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


if __name__ == "__main__":
    unittest.main()
