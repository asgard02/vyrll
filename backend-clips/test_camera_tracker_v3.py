import unittest

from camera_tracker_v3 import BlazeFaceBoxTracker, V3Detection


def detection(x: float, y: float = 0.2, w: float = 0.12, h: float = 0.18):
    return V3Detection((x, y, w, h), (x + w * 0.5, y + h * 0.35), 0.9)


class BlazeFaceBoxTrackerTest(unittest.TestCase):
    def test_confirms_only_after_hits_and_duration(self):
        tracker = BlazeFaceBoxTracker(confirm_hits=3, confirm_seconds=0.8)
        self.assertFalse(tracker.update(0, 0.0, 0, [detection(0.2)])[0].confirmed)
        self.assertFalse(tracker.update(5, 0.4, 0, [detection(0.21)])[0].confirmed)
        self.assertTrue(tracker.update(10, 0.8, 0, [detection(0.22)])[0].confirmed)

    def test_carries_short_miss_without_changing_id(self):
        tracker = BlazeFaceBoxTracker(confirm_hits=1, confirm_seconds=0.0)
        first = tracker.update(0, 0.0, 0, [detection(0.2)])[0]
        carried = tracker.update(5, 0.2, 0, [])[0]
        recovered = tracker.update(10, 0.4, 0, [detection(0.22)])[0]
        self.assertEqual(first.track_id, carried.track_id)
        self.assertEqual(first.track_id, recovered.track_id)
        self.assertFalse(carried.detected)

    def test_resets_tracks_after_scene_cut(self):
        tracker = BlazeFaceBoxTracker(confirm_hits=1, confirm_seconds=0.0)
        first = tracker.update(0, 0.0, 0, [detection(0.2)])[0]
        after_cut = tracker.update(5, 0.2, 1, [detection(0.2)])[0]
        self.assertNotEqual(first.track_id, after_cut.track_id)

    def test_does_not_merge_distant_people(self):
        tracker = BlazeFaceBoxTracker(confirm_hits=1, confirm_seconds=0.0)
        views = tracker.update(0, 0.0, 0, [detection(0.1), detection(0.7)])
        self.assertEqual(2, len({view.track_id for view in views}))


if __name__ == "__main__":
    unittest.main()
