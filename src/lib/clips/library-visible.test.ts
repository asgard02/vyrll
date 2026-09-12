import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isLibraryVisibleClipJob } from "./library-visible.ts";

describe("isLibraryVisibleClipJob", () => {
  it("keeps jobs that produced clips", () => {
    assert.equal(
      isLibraryVisibleClipJob({ status: "done", clips_count: 3 }),
      true
    );
    assert.equal(
      isLibraryVisibleClipJob({ status: "done", clips: [{}, {}] }),
      true
    );
  });

  it("hides analyze-only shells", () => {
    assert.equal(
      isLibraryVisibleClipJob({
        status: "processing",
        clips_count: 0,
        analyze_only: true,
      }),
      false
    );
    assert.equal(
      isLibraryVisibleClipJob({
        status: "done",
        clips_count: 0,
        credits_quoted: 0,
      }),
      false
    );
  });

  it("hides empty completed jobs", () => {
    assert.equal(
      isLibraryVisibleClipJob({ status: "done", clips_count: 0 }),
      false
    );
  });

  it("keeps billed generate jobs that are running or failed", () => {
    assert.equal(
      isLibraryVisibleClipJob({
        status: "processing",
        clips_count: 0,
        credits_quoted: 12,
      }),
      true
    );
    assert.equal(
      isLibraryVisibleClipJob({ status: "error", clips: [], credits_quoted: 8 }),
      true
    );
  });
});
