import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  acceptedDownloadFileName,
  asciiDownloadFileName,
  clipCardDownload,
  clipCardTitle,
  clipDownloadFileName,
  clipDurationChoice,
  contentDispositionHeader,
  displayedDurationSeconds,
  joinProjectMeta,
  sortClipsByViralScore,
  subtitleStyleId,
} from "./project-results.ts";

describe("clipCardTitle", () => {
  it("uses the hook when it is present", () => {
    assert.equal(clipCardTitle("  Pourquoi   ça marche  ", "Clip 2"), "Pourquoi ça marche");
  });

  it("falls back when the hook is missing", () => {
    assert.equal(clipCardTitle(null, "Clip 2"), "Clip 2");
    assert.equal(clipCardTitle("   ", "Clip 1"), "Clip 1");
  });
});

describe("displayedDurationSeconds", () => {
  it("rounds the file duration to the nearest second", () => {
    assert.equal(displayedDurationSeconds(65.6), 66);
    assert.equal(displayedDurationSeconds(65.4), 65);
  });

  it("hides a duration the player does not have yet", () => {
    assert.equal(displayedDurationSeconds(0), null);
    assert.equal(displayedDurationSeconds(Number.NaN), null);
  });
});

describe("project meta", () => {
  it("formats the chosen range, not the source length", () => {
    assert.deepEqual(clipDurationChoice(60, 90), { kind: "range", min: 60, max: 90 });
    assert.deepEqual(clipDurationChoice(60, 60), { kind: "single", seconds: 60 });
    assert.equal(clipDurationChoice(null, null), null);
  });

  it("joins the info line in display order", () => {
    assert.equal(
      joinProjectMeta(["4 clips", "60-90 s", "9:16", "Impact", "12 oct."]),
      "4 clips · 60-90 s · 9:16 · Impact · 12 oct.",
    );
  });

  it("only accepts known subtitle style keys", () => {
    assert.equal(subtitleStyleId("impact"), "impact");
    assert.equal(subtitleStyleId("neon-glow"), null);
  });
});

describe("clipCardDownload", () => {
  it("keeps the storage file when display order differs", () => {
    const clips = [
      { index: 0, downloadUrl: "/api/clips/job/download/0", scoreViral: 50 },
      { index: 1, downloadUrl: "/api/clips/job/download/1", scoreViral: 10 },
      { index: 2, downloadUrl: "/api/clips/job/download/2", scoreViral: 20 },
      { index: 3, downloadUrl: "/api/clips/job/download/3", scoreViral: 40 },
    ];
    const sorted = sortClipsByViralScore(clips);
    const second = clipCardDownload(sorted[1]!, 1, { channel: "Chaîne", title: "Titre" });
    assert.equal(sorted[1]?.index, 3);
    assert.equal(second.fileName, "Chaîne - Titre - clip 2.mp4");
    const href = new URL(second.href ?? "", "http://local");
    assert.equal(href.pathname, "/api/clips/job/download/3");
    assert.equal(href.searchParams.get("filename"), "Chaîne - Titre - clip 2.mp4");
  });
});

describe("clipDownloadFileName", () => {
  it("uses the creator, the video title, and the display position", () => {
    assert.equal(
      clipDownloadFileName({ channel: "Squeezie", title: "Le meilleur moment", displayIndex: 0 }),
      "Squeezie - Le meilleur moment - clip 1.mp4",
    );
  });

  it("omits a missing segment", () => {
    assert.equal(clipDownloadFileName({ title: "Titre", displayIndex: 0 }), "Titre - clip 1.mp4");
    assert.equal(clipDownloadFileName({ channel: "Squeezie", displayIndex: 1 }), "Squeezie - clip 2.mp4");
    assert.equal(clipDownloadFileName({ displayIndex: 0 }), "clip 1.mp4");
  });

  it("strips characters a file name cannot hold", () => {
    assert.equal(
      clipDownloadFileName({ channel: "A/B:C", title: "x\ny", displayIndex: 0 }),
      "ABC - xy - clip 1.mp4",
    );
  });

  it("keeps accents and emoji in the saved name", () => {
    assert.equal(
      clipDownloadFileName({ channel: "Squeezie", title: "Café 🔥", displayIndex: 0 }),
      "Squeezie - Café 🔥 - clip 1.mp4",
    );
  });

  it("caps the prefix at 120 characters and cuts the title first", () => {
    const name = clipDownloadFileName({
      channel: "Squeezie",
      title: "t".repeat(200),
      displayIndex: 0,
    });
    assert.equal(name.endsWith(" - clip 1.mp4"), true);
    const prefix = name.slice(0, name.length - " - clip 1.mp4".length);
    assert.equal(Array.from(prefix).length <= 120, true);
    assert.equal(prefix.startsWith("Squeezie - "), true);
    assert.equal(prefix.includes("t".repeat(20)), true);
  });

  it("cuts the creator when it alone exceeds 120 characters", () => {
    const name = clipDownloadFileName({
      channel: "c".repeat(150),
      title: "Titre",
      displayIndex: 2,
    });
    assert.equal(name, `${"c".repeat(120)} - clip 3.mp4`);
  });
});

describe("download content disposition", () => {
  it("folds accents for filename and keeps them in filename*", () => {
    assert.equal(
      contentDispositionHeader("inline", "Squeezie - Café - clip 1.mp4"),
      "inline; filename=\"Squeezie - Cafe - clip 1.mp4\"; filename*=UTF-8''Squeezie%20-%20Caf%C3%A9%20-%20clip%201.mp4",
    );
  });

  it("drops emoji from the ASCII fallback", () => {
    assert.equal(asciiDownloadFileName("🔥 - clip 1.mp4"), "clip 1.mp4");
  });

  it("rejects a query that is not a clip name and shortens a long prefix", () => {
    assert.equal(acceptedDownloadFileName(null), null);
    assert.equal(acceptedDownloadFileName("evil.exe"), null);
    assert.equal(acceptedDownloadFileName("clip 2.mp4"), "clip 2.mp4");
    const accepted = acceptedDownloadFileName(`${"a".repeat(200)} - clip 4.mp4`);
    assert.equal(accepted, `${"a".repeat(120)} - clip 4.mp4`);
  });
});
