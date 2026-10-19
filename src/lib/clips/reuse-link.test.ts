import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dragCarriesLink, firstAcceptedVideoUrl, reusableProjectUrl } from "./reuse-link.ts";

const YOUTUBE = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const SHORT = "https://youtu.be/dQw4w9WgXcQ";
const TWITCH = "https://www.twitch.tv/videos/123456789";

describe("reusableProjectUrl", () => {
  it("keeps a YouTube or Twitch link", () => {
    assert.equal(reusableProjectUrl(`  ${YOUTUBE}  `), YOUTUBE);
    assert.equal(reusableProjectUrl(TWITCH), TWITCH);
  });

  it("rejects an upload and anything that is not a video link", () => {
    assert.equal(reusableProjectUrl("upload://clip.mp4"), null);
    assert.equal(reusableProjectUrl("https://example.com/watch"), null);
    assert.equal(reusableProjectUrl("  "), null);
    assert.equal(reusableProjectUrl(null), null);
  });
});

describe("firstAcceptedVideoUrl", () => {
  it("prefers text/uri-list over text/plain", () => {
    assert.equal(firstAcceptedVideoUrl(YOUTUBE, TWITCH), YOUTUBE);
  });

  it("skips comments and blank lines, then keeps the first valid URL", () => {
    const uriList = `# comment\n\nhttps://example.com/nope\n${TWITCH}\n${YOUTUBE}`;
    assert.equal(firstAcceptedVideoUrl(uriList, SHORT), TWITCH);
  });

  it("reads text/plain when uri-list has no valid URL", () => {
    assert.equal(firstAcceptedVideoUrl("# https://youtu.be/dQw4w9WgXcQ\n", `see ${SHORT}`), SHORT);
  });

  it("returns null when nothing is a video link", () => {
    assert.equal(firstAcceptedVideoUrl("upload://clip.mp4", "not a link"), null);
    assert.equal(firstAcceptedVideoUrl("", ""), null);
  });
});

describe("dragCarriesLink", () => {
  it("accepts a uri-list drag and a plain-text drag", () => {
    assert.equal(dragCarriesLink(["text/uri-list", "text/plain"]), true);
    assert.equal(dragCarriesLink(["text/plain"]), true);
  });

  it("leaves a video-file drag alone", () => {
    assert.equal(dragCarriesLink(["Files"]), false);
    assert.equal(dragCarriesLink(["Files", "text/plain"]), false);
  });
});
