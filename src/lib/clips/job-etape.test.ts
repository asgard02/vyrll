import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { etapeFromPipeline } from "./job-etape.ts";

describe("etapeFromPipeline", () => {
  it("omits etape when pipeline is empty or has no known step", () => {
    assert.equal(etapeFromPipeline(null), null);
    assert.equal(etapeFromPipeline(undefined), null);
    assert.equal(etapeFromPipeline({}), null);
    assert.equal(etapeFromPipeline([]), null);
    assert.equal(etapeFromPipeline({ etape: "rendu" }), null);
  });

  it("maps the stored step without inventing fields", () => {
    assert.deepEqual(
      etapeFromPipeline({
        etape: "creation",
        cache: null,
        clip: 2,
        sur: 5,
        echec: false,
        moments: [
          { debut: 12.4, fin: 40, titre: "Le titre", score: 8, pourquoi: "la chute" },
        ],
      }),
      {
        id: "creation",
        cache: null,
        clip: 2,
        sur: 5,
        echec: false,
        moments: [
          { debut: 12.4, fin: 40, titre: "Le titre", score: 8, pourquoi: "la chute" },
        ],
      }
    );
  });

  it("accepts moments_prets and a cache hit", () => {
    const etape = etapeFromPipeline({
      etape: "moments_prets",
      cache: "deja_pret",
      echec: true,
    });
    assert.equal(etape?.id, "moments_prets");
    assert.equal(etape?.cache, "deja_pret");
    assert.equal(etape?.echec, true);
    assert.deepEqual(etape?.moments, []);
  });

  it("keeps a failure that has no known step", () => {
    assert.deepEqual(etapeFromPipeline({ echec: true, etape: null }), {
      id: null,
      cache: null,
      clip: null,
      sur: null,
      echec: true,
      moments: [],
    });
    assert.equal(etapeFromPipeline({ etape: "rendu", echec: true })?.id, null);
    assert.equal(etapeFromPipeline({ etape: "rendu", echec: true })?.echec, true);
  });

  it("drops heuristic_pad and keeps an empty title with a real why", () => {
    const etape = etapeFromPipeline({
      etape: "moments_prets",
      clips_demandes: 4,
      moments: [
        { debut: 10, fin: 50, titre: "Hook un", score: 9, pourquoi: "la chute" },
        { debut: 80, fin: 120, titre: "", score: 8, pourquoi: "le détail" },
        { debut: 200, fin: 240, titre: "", score: 6, pourquoi: "heuristic_pad" },
        { debut: 300, fin: 340, titre: "", score: 6, pourquoi: "heuristic_pad" },
        { debut: 400, fin: 440, titre: "", score: 6, pourquoi: "heuristic_fallback" },
      ],
    });
    assert.equal(etape?.clips_demandes, 4);
    assert.deepEqual(
      etape?.moments.map((moment) => moment.pourquoi),
      ["la chute", "le détail", "heuristic_fallback"]
    );
    assert.equal(etape?.moments[1].titre, "");
  });

  it("drops a pad-only list and still keeps heuristic_fallback", () => {
    const pads = etapeFromPipeline({
      etape: "moments_prets",
      clips_demandes: 4,
      moments: [
        { debut: 200, fin: 240, titre: "", score: 6, pourquoi: "heuristic_pad" },
        { debut: 300, fin: 340, titre: "Moment", score: 6, pourquoi: "heuristic_pad" },
      ],
    });
    assert.equal(pads?.id, "moments_prets");
    assert.equal(pads?.clips_demandes, 4);
    assert.deepEqual(pads?.moments, []);

    const fallback = etapeFromPipeline({
      etape: "moments_prets",
      moments: [
        { debut: 10, fin: 40, titre: "", score: 6, pourquoi: "heuristic_fallback" },
        { debut: 50, fin: 80, titre: "", score: 6, pourquoi: "heuristic_pad" },
      ],
    });
    assert.deepEqual(
      fallback?.moments.map((moment) => moment.pourquoi),
      ["heuristic_fallback"]
    );
  });

  it("drops a moment that has no span", () => {
    const etape = etapeFromPipeline({
      etape: "reperage",
      moments: [{ debut: 4, fin: 4, titre: "vide" }, { debut: 1, fin: 3, titre: "ok", score: 5 }],
    });
    assert.equal(etape?.moments.length, 1);
    assert.equal(etape?.moments[0].titre, "ok");
  });
});
