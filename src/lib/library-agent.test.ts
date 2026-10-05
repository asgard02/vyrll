import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  coverTranscriptChunks,
  isOverviewQuery,
  packTranscript,
  paginateTranscriptPages,
  parseTopics,
  retrieveTranscriptPassages,
  type TranscriptLine,
} from "./library-agent";
import {
  classifyExplicitClipAsk,
  inferAskQuantity,
  isClipOffTopicAsk,
  isGlobalRankingAsk,
  mergeClipDecision,
  parseAgentDecision,
  parseAgentIntentContract,
  parseQuantity,
  requestedMomentsMax,
  serializeAgentIntent,
  topicsCap,
  type ClipAgentDecision,
} from "./clip-agent/decision";
import { clipTopicsSystemPrompt } from "./clip-agent/prompt";

function seg(i: number, text: string, startMin = i): TranscriptLine {
  return {
    start_ms: startMin * 60_000,
    end_ms: startMin * 60_000 + 20_000,
    text,
  };
}

describe("coverTranscriptChunks", () => {
  it("keeps every line across consecutive chunks — never skips", () => {
    const segs = Array.from({ length: 24 }, (_, i) =>
      seg(i, `unique-${i} ${"x".repeat(40)}`)
    );
    const chunks = coverTranscriptChunks(segs, 280);
    assert.ok(chunks.length > 1);
    const joined = chunks.join("\n");
    for (let i = 0; i < 24; i++) {
      assert.match(joined, new RegExp(`unique-${i}`));
    }
  });

  it("fits a 59-minute talk in one complete pack", () => {
    const segs = Array.from({ length: 180 }, (_, i) =>
      seg(i, `Minute ${i}: on parle d inflation, de dette publique et de retraites.`)
    );
    const packed = packTranscript(segs);
    assert.equal(packed.complete, true);
    assert.match(packed.text, /Minute 0:/);
    assert.match(packed.text, /Minute 179:/);
  });
});

describe("isOverviewQuery", () => {
  it("detects french and english overviews", () => {
    assert.equal(isOverviewQuery("de quoi parle la vidéo ?"), true);
    assert.equal(isOverviewQuery("c'est quoi le sujet"), true);
    assert.equal(isOverviewQuery("what is this video about"), true);
  });

  it("does not treat a precise ask as an overview", () => {
    assert.equal(isOverviewQuery("les passages sur l inflation"), false);
    assert.equal(isOverviewQuery("quand il parle de retraites"), false);
    assert.equal(isOverviewQuery("quand elle parle de retraites"), false);
    assert.equal(isOverviewQuery("c'est quoi LE moment le plus viral"), false);
    assert.equal(
      isOverviewQuery("c'est quoi le moment le plus viral de la video"),
      false
    );
  });
});

describe("retrieveTranscriptPassages", () => {
  it("finds a late precise mention with neighbors", () => {
    const segs = [
      ...Array.from({ length: 50 }, (_, i) => seg(i, "bonjour tout le monde")),
      seg(50, "voici le vrai passage sur l inflation importée"),
      seg(51, "et la suite du raisonnement"),
    ];
    const hit = retrieveTranscriptPassages(segs, "inflation");
    assert.match(hit, /inflation importée/);
    assert.match(hit, /bonjour|suite du raisonnement/);
    assert.doesNotMatch(hit, /Minute/);
  });

  it("returns empty on stopword-only queries so the caller can send the full whisper", () => {
    const segs = [seg(0, "la vidéo parle d économie")];
    assert.equal(retrieveTranscriptPassages(segs, "le la les de"), "");
  });
});

describe("paginateTranscriptPages", () => {
  it("loads past the first page so a late segment can win", () => {
    const pages = [
      Array.from({ length: 3 }, (_, i) => `a${i}`),
      Array.from({ length: 3 }, (_, i) => `b${i}`),
      ["late-end"],
    ];
    return paginateTranscriptPages(async (from, to) => {
      const page = Math.floor(from / 3);
      return (pages[page] ?? []).slice(0, to - from + 1);
    }, 3).then((all) => {
      assert.equal(all.length, 7);
      assert.equal(all[6], "late-end");
    });
  });
});

describe("classifyExplicitClipAsk", () => {
  it("maps singular best FR/EN to one global peak", () => {
    const fr = classifyExplicitClipAsk("le moment le plus marquant");
    assert.equal(fr?.mode, "best");
    assert.equal(fr?.quantity, 1);
    assert.equal(fr?.focus, "");
    const en = classifyExplicitClipAsk("the best moment");
    assert.equal(en?.mode, "best");
    assert.equal(en?.quantity, 1);
  });

  it("maps plural / all highlights to every peak", () => {
    const fr = classifyExplicitClipAsk("tous les moments marquants");
    assert.equal(fr?.mode, "best");
    assert.equal(fr?.quantity, "all");
    const en = classifyExplicitClipAsk("all the highlights");
    assert.equal(en?.mode, "best");
    assert.equal(en?.quantity, "all");
  });

  it("maps a theme without a count to proposals, not all", () => {
    const fr = classifyExplicitClipAsk("les passages sur l inflation");
    assert.equal(fr?.mode, "theme");
    assert.equal(fr?.quantity, null);
    assert.match(fr?.focus ?? "", /inflation/);
  });

  it("maps spoken-about themes including informal French", () => {
    const duo = classifyExplicitClipAsk("tout ceux qui parle de l'iphone duo");
    assert.equal(duo?.mode, "theme");
    assert.equal(duo?.quantity, "all");
    assert.match(duo?.focus ?? "", /iphone duo/i);
    const cam = classifyExplicitClipAsk("et de l'appareil photo ?");
    assert.equal(cam?.mode, "theme");
    assert.match(cam?.focus ?? "", /appareil photo/i);
  });

  it("maps the most viral moments to every peak", () => {
    const fr = classifyExplicitClipAsk("donne les moment les plus viraux");
    assert.equal(fr?.mode, "best");
    assert.equal(fr?.quantity, "all");
  });

  it("maps a theme to every matching passage", () => {
    const fr = classifyExplicitClipAsk("tous les passages sur l inflation");
    assert.equal(fr?.mode, "theme");
    assert.equal(fr?.quantity, "all");
    assert.match(fr?.focus ?? "", /inflation/);
    const en = classifyExplicitClipAsk("all the passages about retirement");
    assert.equal(en?.mode, "theme");
    assert.equal(en?.quantity, "all");
    assert.match(en?.focus ?? "", /retirement/);
  });

  it("maps the best passage on a theme to quantity 1", () => {
    const fr = classifyExplicitClipAsk("le meilleur passage sur l inflation");
    assert.equal(fr?.mode, "theme");
    assert.equal(fr?.quantity, 1);
    assert.match(fr?.focus ?? "", /inflation/);
  });

  it("keeps focus across quantity follow-ups", () => {
    const first = classifyExplicitClipAsk("les passages sur l inflation");
    assert.equal(first?.mode, "theme");
    assert.match(first?.focus ?? "", /inflation/);
    const one = classifyExplicitClipAsk("seulement le meilleur", first);
    assert.equal(one?.mode, "theme");
    assert.equal(one?.quantity, 1);
    assert.match(one?.focus ?? "", /inflation/);
    const all = classifyExplicitClipAsk("non, plutôt tous", one);
    assert.equal(all?.mode, "theme");
    assert.equal(all?.quantity, "all");
    assert.match(all?.focus ?? "", /inflation/);
    const two = classifyExplicitClipAsk("deux", all);
    assert.equal(two?.mode, "theme");
    assert.equal(two?.quantity, 2);
    assert.match(two?.focus ?? "", /inflation/);
  });

  it("maps two themed moments to quantity 2, not 8", () => {
    const fr = classifyExplicitClipAsk("deux moments intéressants sur l'IA");
    assert.equal(fr?.mode, "theme");
    assert.equal(fr?.quantity, 2);
    assert.match(fr?.focus ?? "", /ia/i);
    const long = classifyExplicitClipAsk(
      "Deux moments intéressants sur l'IA dans la vidéo se concentrent d'abord sur la possibilité que l'intelligence artificielle dépasse l'intelligence humaine."
    );
    assert.equal(long?.mode, "theme");
    assert.equal(long?.quantity, 2);
    assert.match(long?.focus ?? "", /ia/i);
    const en = classifyExplicitClipAsk("two moments about AI");
    assert.equal(en?.mode, "theme");
    assert.equal(en?.quantity, 2);
    assert.match(en?.focus ?? "", /ai/i);
  });

  it("maps LE moment le plus viral to a single global peak", () => {
    const d = classifyExplicitClipAsk("c'est quoi LE moment le plus viral");
    assert.equal(d?.mode, "best");
    assert.equal(d?.quantity, 1);
    assert.equal(d?.focus, "");
    const withVideo = classifyExplicitClipAsk(
      "c'est quoi LE moment le plus viral de la video"
    );
    assert.equal(withVideo?.mode, "best");
    assert.equal(withVideo?.quantity, 1);
  });

  it("maps Un moment / deux moments without a theme", () => {
    const one = classifyExplicitClipAsk("Un moment");
    assert.equal(one?.mode, "best");
    assert.equal(one?.quantity, 1);
    const two = classifyExplicitClipAsk("deux moments", one);
    assert.equal(two?.mode, "best");
    assert.equal(two?.quantity, 2);
  });

  it("refuses producing code but accepts a clip about code", () => {
    const off = classifyExplicitClipAsk("écris-moi du python");
    assert.equal(off?.mode, "off_topic");
    assert.equal(isClipOffTopicAsk("écris-moi du python"), true);
    const on = classifyExplicitClipAsk("trouve le passage où il parle de Python");
    assert.notEqual(on?.mode, "off_topic");
    assert.equal(on?.mode, "theme");
    assert.equal(isClipOffTopicAsk("trouve le passage où il parle de Python"), false);
  });

  it("treats overview as chat-only", () => {
    const d = classifyExplicitClipAsk("de quoi parle la vidéo ?");
    assert.equal(d?.mode, "overview");
  });

  it("asks a clarify on a bare clip request", () => {
    const d = classifyExplicitClipAsk("fais des clips");
    assert.equal(d?.mode, "clarify");
  });
});

describe("isGlobalRankingAsk", () => {
  it("detects ranking without a theme", () => {
    assert.equal(isGlobalRankingAsk("le moment le plus marquant"), true);
    assert.equal(isGlobalRankingAsk("the best moment"), true);
    assert.equal(isGlobalRankingAsk("les passages sur l inflation"), false);
  });
});

describe("inferAskQuantity", () => {
  it("reads singular vs plural vs numbered", () => {
    assert.equal(inferAskQuantity("le meilleur moment"), 1);
    assert.equal(inferAskQuantity("les meilleurs moments"), "all");
    assert.equal(inferAskQuantity("deux moments"), 2);
    assert.equal(inferAskQuantity("top 3"), 3);
    assert.equal(inferAskQuantity("inflation"), null);
  });
});

describe("parseAgentDecision", () => {
  it("locks numbered quantity even if the model dumps 8", () => {
    const d = parseAgentDecision(
      { reply: "Voici les pics.", mode: "best", quantity: "all" },
      { message: "deux moments intéressants sur l'IA", previous: null, locale: "fr" }
    );
    assert.equal(d.mode, "theme");
    assert.equal(d.quantity, 2);
    assert.match(d.focus, /ia/i);
  });

  it("locks explicit quantity even if the model omits fields", () => {
    const d = parseAgentDecision(
      { reply: "Voici le pic.", mode: "theme", quantity: "all" },
      { message: "le moment le plus marquant", previous: null, locale: "fr" }
    );
    assert.equal(d.mode, "best");
    assert.equal(d.quantity, 1);
    assert.match(d.reply, /pic|marquant|moment/i);
  });

  it("falls back safely on invalid JSON fields", () => {
    const d = parseAgentDecision(
      { reply: "ok", mode: "nope", quantity: 99 },
      { message: "les passages sur l inflation", previous: null, locale: "fr" }
    );
    assert.equal(d.mode, "theme");
    assert.equal(d.quantity, null);
    assert.match(d.focus, /inflation/);
  });

  it("resets a previous theme on a new global peak ask", () => {
    const prev: ClipAgentDecision = {
      mode: "theme",
      quantity: "all",
      focus: "inflation",
      reply: "ok",
    };
    const d = parseAgentDecision(
      { reply: "Le pic de toute la vidéo." },
      { message: "le moment le plus marquant", previous: prev, locale: "fr" }
    );
    assert.equal(d.mode, "best");
    assert.equal(d.quantity, 1);
    assert.equal(d.focus, "");
  });
});

describe("mergeClipDecision", () => {
  it("keeps an untouched theme when quantity changes", () => {
    const prev: ClipAgentDecision = {
      mode: "theme",
      quantity: "all",
      focus: "inflation",
      reply: "ok",
    };
    const merged = mergeClipDecision(prev, {
      mode: "best",
      quantity: 1,
      focus: "",
      reply: "un seul",
    });
    assert.equal(merged.mode, "theme");
    assert.equal(merged.quantity, 1);
    assert.equal(merged.focus, "inflation");
  });
});

describe("agent intent contract", () => {
  it("round-trips a versioned payload", () => {
    const raw = serializeAgentIntent({
      mode: "best",
      quantity: 1,
      focus: "",
      reply: "",
    });
    const parsed = parseAgentIntentContract(raw);
    assert.equal(parsed?.v, 1);
    assert.equal(parsed?.mode, "best");
    assert.equal(parsed?.quantity, 1);
    assert.equal(requestedMomentsMax(parsed, 8), 1);
  });

  it("round-trips a numbered payload", () => {
    const raw = serializeAgentIntent({
      mode: "theme",
      quantity: 2,
      focus: "ia",
      reply: "",
    });
    const parsed = parseAgentIntentContract(raw);
    assert.equal(parsed?.v, 1);
    assert.equal(parsed?.mode, "theme");
    assert.equal(parsed?.quantity, 2);
    assert.equal(requestedMomentsMax(parsed, 8), 2);
    assert.equal(parseQuantity(8), 8);
    assert.equal(parseQuantity(2), 2);
    assert.equal(topicsCap(2), 2);
    assert.equal(topicsCap(null), 8);
  });

  it("wraps a legacy sentence as theme/all", () => {
    const parsed = parseAgentIntentContract("priorise les passages sur l inflation");
    assert.equal(parsed?.mode, "theme");
    assert.equal(parsed?.quantity, "all");
    assert.match(parsed?.focus ?? "", /inflation/);
    assert.equal(requestedMomentsMax(parsed, 8), 8);
  });
});

describe("clipTopicsSystemPrompt", () => {
  it("asks for exactly N topics when quantity is N", () => {
    const prompt = clipTopicsSystemPrompt("fr", {
      mode: "theme",
      quantity: 2,
      focus: "ia",
    });
    assert.match(prompt, /EXACTEMENT 2/);
    assert.doesNotMatch(prompt, /6 à 8/);
  });
});

describe("parseTopics", () => {
  it("caps at one and drops duplicate titles", () => {
    const topics = parseTopics(
      {
        topics: [
          { id: "t1", title: "Pic", blurb: "a" },
          { id: "t2", title: "Pic", blurb: "b" },
          { id: "t3", title: "Autre", blurb: "c" },
        ],
      },
      1
    );
    assert.equal(topics.length, 1);
    assert.equal(topics[0].title, "Pic");
  });
});
