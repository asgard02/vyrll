import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { segmentsForOwnedJob } from "./owned-transcript";

const YOUTUBE = "https://www.youtube.com/watch?v=abcdefghijk";
const SHORT = "https://youtu.be/abcdefghijk";

describe("segmentsForOwnedJob", () => {
  it("returns 404 and does not read segments when the job is not the user's", async () => {
    let reads = 0;
    const result = await segmentsForOwnedJob({
      userId: "user-1",
      jobId: "job-other",
      readJob: async () => null,
      readSegments: async () => {
        reads += 1;
        return [{ text: "secret" }];
      },
    });
    assert.deepEqual(result, { ok: false, status: 404 });
    assert.equal(reads, 0);
  });

  it("returns the same segments for two jobs of the same video", async () => {
    const segments = [{ start_ms: 0, text: "bonjour" }];
    const keys: string[] = [];
    const readSegments = async (videoKey: string) => {
      keys.push(videoKey);
      return segments;
    };
    const first = await segmentsForOwnedJob({
      userId: "user-1",
      jobId: "job-a",
      readJob: async () => ({ id: "job-a", url: YOUTUBE }),
      readSegments,
    });
    const second = await segmentsForOwnedJob({
      userId: "user-1",
      jobId: "job-b",
      readJob: async () => ({ id: "job-b", url: SHORT }),
      readSegments,
    });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (!first.ok || !second.ok) return;
    assert.equal(first.videoKey, "abcdefghijk");
    assert.equal(second.videoKey, first.videoKey);
    assert.deepEqual(first.segments, second.segments);
    assert.deepEqual(keys, ["abcdefghijk", "abcdefghijk"]);
  });
});
