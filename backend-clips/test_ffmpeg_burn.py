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


class TestFfmpegBurnEncode(unittest.TestCase):
    def test_talk_pass2_encodes_short_clip(self):
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


if __name__ == "__main__":
    unittest.main()
