"""Deux passages Pillow sur les mêmes cues gardent les mêmes temps."""

import copy
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

import render_subtitles as rs


def _times(blocks):
    return [
        (
            round(float(block["bloc_start"]), 3),
            round(float(block["bloc_end"]), 3),
            [
                (round(float(word["start"]), 3), round(float(word["end"]), 3))
                for word in block["words"]
            ],
        )
        for block in blocks
    ]


def _fake_voice(_video_path, _start, _duration, hop=0.05):
    voiced = np.zeros(160, dtype=bool)
    voiced[8:] = True
    return voiced, hop


def test_two_passes_keep_the_same_times():
    transcription = {
        "subtitle_cues": [
            {
                "bloc_start": 0.0,
                "bloc_end": 4.0,
                "words": [
                    {"word": "UN", "start": 0.0, "end": 0.4, "line_index": 0},
                    {"word": "DEUX", "start": 0.4, "end": 0.8, "line_index": 0},
                ],
            }
        ]
    }
    before = copy.deepcopy(transcription)
    rs.compute_voice_activity = _fake_voice
    path = str(Path(__file__).resolve())

    first = rs._load_blocks_for_clip(transcription, 0, 6, "impact", path)
    second = rs._load_blocks_for_clip(transcription, 0, 6, "impact", path)

    assert _times(first) == _times(second)
    assert first[0]["bloc_start"] > 0.2
    assert transcription == before
    assert transcription["subtitle_cues"][0]["words"][0]["start"] == 0.0


if __name__ == "__main__":
    test_two_passes_keep_the_same_times()
    print("ok")
