import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { publishCopyBundle } from "./publish-copy-bundle.ts";

const copy = {
  title: "Le titre",
  descriptionTiktok: "Texte TikTok",
  descriptionShorts: "Texte Shorts",
  descriptionInstagram: "Texte Instagram",
  hashtags: ["#un", " #deux "],
};

describe("publishCopyBundle", () => {
  it("puts the description then the hashtags for TikTok and Instagram", () => {
    assert.equal(publishCopyBundle(copy, "tiktok"), "Texte TikTok\n\n#un #deux");
    assert.equal(publishCopyBundle(copy, "instagram"), "Texte Instagram\n\n#un #deux");
  });

  it("puts the title first for Shorts", () => {
    assert.equal(
      publishCopyBundle(copy, "shorts"),
      "Le titre\n\nTexte Shorts\n\n#un #deux"
    );
  });

  it("skips empty parts and still separates the rest with a blank line", () => {
    assert.equal(
      publishCopyBundle({ ...copy, descriptionTiktok: "  ", hashtags: ["", " #seul "] }, "tiktok"),
      "#seul"
    );
    assert.equal(
      publishCopyBundle({ ...copy, title: "", descriptionShorts: "Seul le texte" }, "shorts"),
      "Seul le texte\n\n#un #deux"
    );
  });
});
