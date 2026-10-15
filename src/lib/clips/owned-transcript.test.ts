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
      readSegmentsByJobId: async () => {
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
    let jobReads = 0;
    const readSegments = async (videoKey: string) => {
      keys.push(videoKey);
      return segments;
    };
    const readSegmentsByJobId = async () => {
      jobReads += 1;
      return [];
    };
    const first = await segmentsForOwnedJob({
      userId: "user-1",
      jobId: "job-a",
      readJob: async () => ({ id: "job-a", url: YOUTUBE }),
      readSegments,
      readSegmentsByJobId,
    });
    const second = await segmentsForOwnedJob({
      userId: "user-1",
      jobId: "job-b",
      readJob: async () => ({ id: "job-b", url: SHORT }),
      readSegments,
      readSegmentsByJobId,
    });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (!first.ok || !second.ok) return;
    assert.equal(first.videoKey, "abcdefghijk");
    assert.equal(second.videoKey, first.videoKey);
    assert.deepEqual(first.segments, second.segments);
    assert.deepEqual(keys, ["abcdefghijk", "abcdefghijk"]);
    assert.equal(jobReads, 0);
  });

  it("reads an upload by the verified job id when video_key is empty", async () => {
    const calls: string[] = [];
    const result = await segmentsForOwnedJob({
      userId: "user-1",
      jobId: "from-client",
      readJob: async () => ({ id: "job-upload", url: "upload://nom" }),
      readSegments: async (videoKey) => {
        calls.push(`key:${videoKey}`);
        return [];
      },
      readSegmentsByJobId: async (jobId) => {
        calls.push(`job:${jobId}`);
        return [{ text: "fichier" }];
      },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.segments, [{ text: "fichier" }]);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].startsWith("key:"), true);
    assert.equal(calls[1], "job:job-upload");
  });

  it("does not read by job id when the video key already has segments", async () => {
    let jobReads = 0;
    const result = await segmentsForOwnedJob({
      userId: "user-1",
      jobId: "job-yt",
      readJob: async () => ({ id: "job-yt", url: YOUTUBE }),
      readSegments: async () => [{ text: "bonjour" }],
      readSegmentsByJobId: async () => {
        jobReads += 1;
        return [{ text: "autre" }];
      },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.segments, [{ text: "bonjour" }]);
    assert.equal(jobReads, 0);
  });
});
