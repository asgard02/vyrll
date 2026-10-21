import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  billedMinutesForChoice,
  choiceCountdownMs,
  matchMomentChoice,
  momentScore100,
} from "./moments-choice.ts";
import type { JobEtapeMoment } from "./job-etape.ts";
import { youtubeMomentEmbedUrl } from "../youtube.ts";

const stored: JobEtapeMoment[] = [
  { debut: 12, fin: 40, titre: "a", score: 8, pourquoi: "p" },
  { debut: 80, fin: 110, titre: "b", score: 6, pourquoi: "q" },
];

describe("matchMomentChoice", () => {
  it("matches within 0.05s and keeps the request order", () => {
    const matched = matchMomentChoice(stored, [
      { debut: 80.04, fin: 110.04 },
      { debut: 12, fin: 40 },
    ]);
    assert.equal(matched.ok, true);
    if (!matched.ok) return;
    assert.deepEqual(
      matched.chosen.map((moment) => moment.titre),
      ["b", "a"]
    );
  });

  it("rejects an unknown moment and an empty list", () => {
    assert.equal(matchMomentChoice(stored, []).ok, false);
    const unknown = matchMomentChoice(stored, [{ debut: 1, fin: 2 }]);
    assert.equal(unknown.ok, false);
    if (unknown.ok) return;
    assert.equal(unknown.reason, "unknown");
  });
});

describe("youtube preview", () => {
  it("opens the source video at the moment", () => {
    assert.equal(
      youtubeMomentEmbedUrl("https://www.youtube.com/watch?v=abcdefghijk", 12.9),
      "https://www.youtube-nocookie.com/embed/abcdefghijk?start=12&autoplay=1"
    );
    assert.equal(youtubeMomentEmbedUrl("https://www.twitch.tv/videos/9", 4), null);
  });
});

describe("choice screen helpers", () => {
  it("turns a score of 8 into 80", () => {
    assert.equal(momentScore100(8), 80);
    assert.equal(momentScore100(8) >= 80, true);
    assert.equal(momentScore100(7) >= 80, false);
  });

  it("freezes the 10 minute countdown at the first checkbox", () => {
    const ready = "2026-10-21T10:00:00.000Z";
    const readyMs = Date.parse(ready);
    const paused = new Date(readyMs + 4 * 60 * 1000).toISOString();
    assert.equal(choiceCountdownMs(ready, readyMs + 9 * 60 * 1000, null), 60_000);
    assert.equal(choiceCountdownMs(ready, readyMs + 20 * 60 * 1000, paused), 6 * 60 * 1000);
  });

  it("shows the quoted minutes, and recomputes them the same way as the debit", () => {
    assert.equal(billedMinutesForChoice({ credits_quoted: 11 }), 11);
    assert.equal(
      billedMinutesForChoice({
        clip_mode: "manual",
        search_window_start_sec: 0,
        search_window_end_sec: 90,
      }),
      2
    );
    assert.equal(billedMinutesForChoice({ source_duration_seconds: 125 }), 3);
  });
});
