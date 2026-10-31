import assert from "node:assert/strict";
import test from "node:test";
import { chooseSegmentSync } from "./segment-sync.js";

test("flat YouTube probes stay none until the keyframe lead is measured", () => {
  const flat = chooseSegmentSync({
    vStart: 0,
    aStart: 0,
    vPkt: -2.05,
    aPkt: -1.02,
    vDur: 120,
    aDur: 120,
    framesDur: 120,
    formatDur: 120,
    requestedDur: 120,
  });
  assert.equal(flat.method, "none");
  assert.equal(flat.trimSec, 0);

  const lead = chooseSegmentSync({
    vStart: 0,
    aStart: 0,
    vPkt: -2.05,
    aPkt: -1.02,
    vDur: 120,
    aDur: 120,
    framesDur: 120,
    formatDur: 122.4,
    requestedDur: 120,
  });
  assert.equal(lead.method, "section_lead");
  assert.equal(lead.trimBoth, true);
  assert.ok(Math.abs(lead.trimSec - 2.4) < 1e-9);
});

test("a separate audio/video download supplies a sync when the mux is flat", () => {
  const synced = chooseSegmentSync({
    vStart: 0,
    aStart: 0,
    formatDur: 90,
    requestedDur: 90,
    separateSkew: 1.8,
  });
  assert.equal(synced.method, "separate");
  assert.equal(synced.trimSec, 1.8);
  assert.equal(synced.trimBoth, false);
});
