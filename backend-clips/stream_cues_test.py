"""Deux lectures stream du même JSON ne décalent pas les cues deux fois."""

import copy
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

import render_subtitles as rs
import stream_layout as sl


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


def test_two_loads_keep_the_same_times():
    transcription = {
        "subtitle_cues": [
            {
                "bloc_start": 1.0,
                "bloc_end": 2.2,
                "words": [
                    {"word": "UN", "start": 1.0, "end": 1.3, "line_index": 0},
                    {"word": "DEUX", "start": 1.3, "end": 1.6, "line_index": 0},
                    {"word": "TROIS", "start": 1.6, "end": 1.9, "line_index": 1},
                ],
            }
        ]
    }
    before = copy.deepcopy(transcription)
    sl._speech_band_rms = lambda *_args, **_kwargs: np.ones(40)
    sl._estimate_whisper_audio_offset = lambda *_args, **_kwargs: (-0.4, 1.0)
    sl._resolve_stream_whisper_offset = lambda raw, _margin: (raw, "test")

    first = sl._load_stream_subtitle_blocks(rs, transcription, 0, 4, "impact", "/tmp/absent.mp4")
    second = sl._load_stream_subtitle_blocks(rs, transcription, 0, 4, "impact", "/tmp/absent.mp4")

    assert _times(first) == _times(second)
    assert abs(first[0]["words"][0]["start"] - 0.6) < 0.02
    assert transcription == before


if __name__ == "__main__":
    test_two_loads_keep_the_same_times()
    print("ok")
