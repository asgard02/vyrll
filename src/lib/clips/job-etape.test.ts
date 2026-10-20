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

  it("drops a moment that has no span", () => {
    const etape = etapeFromPipeline({
      etape: "reperage",
      moments: [{ debut: 4, fin: 4, titre: "vide" }, { debut: 1, fin: 3, titre: "ok", score: 5 }],
    });
    assert.equal(etape?.moments.length, 1);
    assert.equal(etape?.moments[0].titre, "ok");
  });
});
