import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isMissingRpcError,
  jsonbSetClip,
  patchClipJobAtIndex,
} from "./clip-patch.js";

describe("jsonbSetClip", () => {
  it("keeps both clips when two patches run one after the other", () => {
    const base = [
      { url: "a", text: "un" },
      { url: "b", text: "deux" },
    ];
    const after0 = jsonbSetClip(base, 0, { subtitle_lines: { cuts: [1], style: "impact" } });
    const kept = jsonbSetClip(after0, 1, { subtitle_lines: { cuts: [4], style: "neon" } });
    assert.deepEqual(kept[0].subtitle_lines, { cuts: [1], style: "impact" });
    assert.equal(kept[0].url, "a");
    assert.equal(kept[0].text, "un");
    assert.deepEqual(kept[1].subtitle_lines, { cuts: [4], style: "neon" });
    assert.equal(kept[1].url, "b");
    assert.equal(kept[1].text, "deux");
  });

  it("refuses an index at or past the end of the array", () => {
    const base = [{ url: "a", text: "un" }];
    for (const index of [1, 2, -1]) {
      assert.throws(() => jsonbSetClip(base, index, { url: "b" }), /invalid clip index/);
    }
    assert.equal(base.length, 1);
    assert.equal(base[0].url, "a");
    assert.equal(base[0].text, "un");
  });

  it("a stale full-array write drops the other clip", () => {
    const base = [{ url: "a" }, { url: "b" }];
    const stale0 = jsonbSetClip(base, 0, { subtitle_lines: { cuts: [1] } });
    const stale1 = jsonbSetClip(base, 1, { subtitle_lines: { cuts: [4] } });
    assert.equal(stale1[0].subtitle_lines, undefined);
    const kept = jsonbSetClip(stale0, 1, { subtitle_lines: { cuts: [4] } });
    assert.deepEqual(kept[0].subtitle_lines.cuts, [1]);
    assert.deepEqual(kept[1].subtitle_lines.cuts, [4]);
  });
});

describe("patchClipJobAtIndex", () => {
  it("applies two parallel patches without dropping either subtitle_lines", async () => {
    let clips = [
      { url: "a", text: "un" },
      { url: "b", text: "deux" },
    ];
    let chain = Promise.resolve();
    const rowLock = (fn) => {
      const run = chain.then(fn);
      chain = run.then(
        () => {},
        () => {}
      );
      return run;
    };

    async function patch(index, subtitleLines) {
      return rowLock(() =>
        patchClipJobAtIndex({
          jobId: "job",
          index,
          patch: { subtitle_lines: subtitleLines },
          rpc: async () => ({ error: { code: "PGRST202", message: "function not found" } }),
          read: async () => ({ clips }),
          write: async (next) => {
            await new Promise((resolve) => setTimeout(resolve, 15));
            clips = next;
            return {};
          },
        })
      );
    }

    const [a, b] = await Promise.all([
      patch(0, { cuts: [1], style: "impact", source: "rules" }),
      patch(1, { cuts: [4], style: "neon", source: "model" }),
    ]);
    assert.equal(a.via, "fallback");
    assert.equal(b.via, "fallback");
    assert.deepEqual(clips[0].subtitle_lines.cuts, [1]);
    assert.equal(clips[0].url, "a");
    assert.deepEqual(clips[1].subtitle_lines.cuts, [4]);
    assert.equal(clips[1].text, "deux");
  });

  it("uses the rpc when the function exists", async () => {
    let called = false;
    const result = await patchClipJobAtIndex({
      jobId: "job",
      userId: "user-1",
      index: 0,
      patch: { subtitle_lines: { cuts: [2] } },
      rpc: async (name, args) => {
        called = true;
        assert.equal(name, "patch_clip_job_at_index");
        assert.equal(args.p_index, 0);
        assert.equal(args.p_user_id, "user-1");
        return {};
      },
      read: async () => {
        throw new Error("should not read");
      },
      write: async () => {
        throw new Error("should not write");
      },
    });
    assert.equal(called, true);
    assert.equal(result.via, "rpc");
  });

  it("recognizes a missing function", () => {
    assert.equal(isMissingRpcError({ code: "PGRST202", message: "Could not find the function" }), true);
    assert.equal(isMissingRpcError({ code: "42883", message: "function patch_clip_job_at_index does not exist" }), true);
    assert.equal(isMissingRpcError({ message: "function not found" }), true);
    assert.equal(isMissingRpcError({ message: "permission denied" }), false);
  });
});
