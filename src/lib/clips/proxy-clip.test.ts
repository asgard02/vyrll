import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  clipAttachmentName,
  parseClipMediaLayer,
  storedClipUrlForLayer,
} from "./proxy-clip.ts";

describe("parseClipMediaLayer", () => {
  it("accepts clean and source", () => {
    assert.equal(parseClipMediaLayer("clean"), "clean");
    assert.equal(parseClipMediaLayer("source"), "source");
  });

  it("defaults unknown values to the burned clip", () => {
    assert.equal(parseClipMediaLayer(null), "clip");
    assert.equal(parseClipMediaLayer("burned"), "clip");
  });
});

describe("clipAttachmentName", () => {
  it("suffixes clean and source files", () => {
    assert.equal(clipAttachmentName(0), "clip-1.mp4");
    assert.equal(clipAttachmentName(0, "clean"), "clip-1-clean.mp4");
    assert.equal(clipAttachmentName(2, "source"), "clip-3-source.mp4");
  });
});

describe("storedClipUrlForLayer", () => {
  const clip = {
    url: "https://cdn.example/clip.mp4",
    clean_url: "https://cdn.example/clean.mp4",
    source_url: "https://cdn.example/source.mp4",
  };

  it("picks the matching http url", () => {
    assert.equal(storedClipUrlForLayer(clip, "clip"), clip.url);
    assert.equal(storedClipUrlForLayer(clip, "clean"), clip.clean_url);
    assert.equal(storedClipUrlForLayer(clip, "source"), clip.source_url);
  });

  it("returns null when the layer is missing", () => {
    assert.equal(storedClipUrlForLayer({ url: "https://x/a.mp4" }, "clean"), null);
  });
});
