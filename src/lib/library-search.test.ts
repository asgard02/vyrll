import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  clampK,
  mergeContiguousMoments,
  tokenizeQuery,
  type RankedSegment,
} from "./library-search";

describe("tokenizeQuery", () => {
  it("drops french stopwords and keeps topic terms", () => {
    assert.deepEqual(tokenizeQuery("la dette publique"), ["dette", "publique"]);
    assert.deepEqual(tokenizeQuery("taxer les riches"), ["taxer", "riches"]);
    assert.deepEqual(tokenizeQuery("où il explique l inflation"), ["explique", "inflation"]);
  });

  it("returns empty when only stopwords", () => {
    assert.deepEqual(tokenizeQuery("le la les de"), []);
  });
});

describe("mergeContiguousMoments", () => {
  const hit = (over: Partial<RankedSegment>): RankedSegment => ({
    video_key: "vid",
    title: "Talk",
    source_url: "https://youtu.be/vid",
    start_ms: 0,
    end_ms: 12_000,
    text: "dette",
    rank: 0.4,
    ...over,
  });

  it("merges same-video hits less than 60s apart", () => {
    const moments = mergeContiguousMoments(
      [
        hit({ start_ms: 1_686_000, end_ms: 1_698_000, text: "la dette", rank: 0.5 }),
        hit({ start_ms: 1_710_000, end_ms: 1_730_000, text: "publique expliquée", rank: 0.4 }),
      ],
      5
    );
    assert.equal(moments.length, 1);
    assert.equal(moments[0].n_segments, 2);
    assert.equal(moments[0].start_ms, 1_686_000);
    assert.equal(moments[0].end_ms, 1_730_000);
    assert.equal(moments[0].score, 0.99); // (0.5+0.4) * 1.1
  });

  it("does not merge gaps of 60s or more", () => {
    const moments = mergeContiguousMoments(
      [
        hit({ start_ms: 0, end_ms: 12_000, rank: 0.5 }),
        hit({ start_ms: 72_000, end_ms: 84_000, rank: 0.5, text: "plus tard" }),
      ],
      5
    );
    assert.equal(moments.length, 2);
  });

  it("drops a standalone segment shorter than 6s", () => {
    const moments = mergeContiguousMoments(
      [hit({ start_ms: 0, end_ms: 4000, text: "dette", rank: 0.9 })],
      5
    );
    assert.equal(moments.length, 0);
  });

  it("keeps a short hit when fused into a longer window", () => {
    const moments = mergeContiguousMoments(
      [
        hit({ start_ms: 0, end_ms: 4000, text: "dette", rank: 0.5 }),
        hit({ start_ms: 5000, end_ms: 20_000, text: "publique", rank: 0.5 }),
      ],
      5
    );
    assert.equal(moments.length, 1);
    assert.equal(moments[0].n_segments, 2);
    assert.equal(moments[0].end_ms, 20_000);
  });

  it("sorts by aggregated score and respects k", () => {
    const moments = mergeContiguousMoments(
      [
        hit({ video_key: "a", start_ms: 0, end_ms: 12_000, rank: 0.2, text: "a" }),
        hit({ video_key: "b", start_ms: 0, end_ms: 12_000, rank: 0.8, text: "b" }),
      ],
      1
    );
    assert.equal(moments.length, 1);
    assert.equal(moments[0].video_key, "b");
  });
});

describe("clampK", () => {
  it("defaults and caps", () => {
    assert.equal(clampK(undefined), 5);
    assert.equal(clampK(100), 20);
    assert.equal(clampK(0), 1);
  });
});
