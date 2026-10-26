import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loaderFromEtape, showCreationCountDuringPartial, type LoaderStepState } from "./job-loader.ts";

function states(view: NonNullable<ReturnType<typeof loaderFromEtape>>): LoaderStepState[] {
  return view.steps.map((step) => step.state);
}

describe("loaderFromEtape", () => {
  it("keeps the current loader when the step is empty", () => {
    assert.equal(loaderFromEtape(null), null);
    assert.equal(loaderFromEtape(undefined), null);
    assert.equal(loaderFromEtape({}), null);
    assert.equal(loaderFromEtape({ id: "moments_prets" }), null);
  });

  it("maps each step to one finished quarter", () => {
    const download = loaderFromEtape({ id: "telechargement" });
    assert.equal(download?.percent, 0);
    assert.deepEqual(states(download!), ["current", "upcoming", "upcoming", "upcoming"]);
    assert.equal(download?.steps[0].label, "Téléchargement");
    assert.equal(download?.steps[3].label, "Création des clips");

    const transcript = loaderFromEtape({ id: "transcription" });
    assert.equal(transcript?.percent, 25);
    assert.deepEqual(states(transcript!), ["done", "current", "upcoming", "upcoming"]);
    assert.equal(transcript?.steps[1].label, "Transcription");

    const spot = loaderFromEtape({ id: "reperage" });
    assert.equal(spot?.percent, 50);
    assert.deepEqual(states(spot!), ["done", "done", "current", "upcoming"]);
    assert.equal(spot?.steps[2].label, "Repérage des moments");

    const creating = loaderFromEtape({ id: "creation" });
    assert.equal(creating?.percent, 75);
    assert.deepEqual(states(creating!), ["done", "done", "done", "current"]);
    assert.equal(creating?.steps[3].label, "Création des clips…");
  });

  it("checks a cached step immediately", () => {
    const view = loaderFromEtape({ id: "transcription", cache: "deja_pret" });
    assert.equal(view?.percent, 50);
    assert.equal(view?.failed, false);
    assert.deepEqual(states(view!), ["done", "done", "upcoming", "upcoming"]);
    assert.equal(view?.steps[1].label, "Déjà prête");
    assert.equal(view?.steps.find((step) => step.state === "current"), undefined);
  });

  it("does not invent a clip total while sur is unknown", () => {
    const missing = loaderFromEtape({ id: "creation", clip: 1, sur: null });
    const zero = loaderFromEtape({ id: "creation", clip: 1, sur: 0 });
    assert.equal(missing?.steps[3].label, "Création des clips…");
    assert.equal(zero?.steps[3].label, "Création des clips…");
    assert.equal(missing?.percent, 75);
    assert.equal(zero?.percent, 75);
    assert.equal(missing?.steps[3].label.includes("sur"), false);
  });

  it("shows the clip count and fills the last quarter", () => {
    const view = loaderFromEtape({ id: "creation", clip: 2, sur: 5 });
    assert.equal(view?.steps[3].label, "Clip 2 sur 5");
    assert.equal(view?.percent, 85);
    assert.equal(view?.steps[3].state, "current");
  });

  it("raises sur to clip when the count overshoots", () => {
    const view = loaderFromEtape({ id: "creation", clip: 4, sur: 2 });
    assert.equal(view?.steps[3].label, "Clip 4 sur 4");
    assert.equal(view?.percent, 100);
  });

  it("stops the bar on the failed step", () => {
    const view = loaderFromEtape({ id: "reperage", echec: true });
    assert.equal(view?.failed, true);
    assert.equal(view?.percent, 50);
    assert.deepEqual(states(view!), ["done", "done", "error", "upcoming"]);
    assert.equal(view?.steps[2].label, "Repérage des moments");

    const creating = loaderFromEtape({ id: "creation", clip: 1, sur: 4, echec: true });
    assert.equal(creating?.percent, 81.25);
    assert.equal(creating?.steps[3].state, "error");
    assert.equal(creating?.steps[3].label, "Clip 1 sur 4");
  });

  it("pins a failure without a step on the first row", () => {
    const view = loaderFromEtape({ id: null, echec: true });
    assert.equal(view?.failed, true);
    assert.equal(view?.percent, 0);
    assert.deepEqual(states(view!), ["error", "upcoming", "upcoming", "upcoming"]);
    assert.equal(view?.steps[0].label, "Téléchargement");
    assert.equal(loaderFromEtape({ echec: true })?.steps[0].state, "error");
  });

  it("keeps the cached quarter when the job fails before the next step", () => {
    const view = loaderFromEtape({ id: "transcription", cache: "deja_pret", echec: true });
    assert.equal(view?.percent, 50);
    assert.equal(view?.failed, true);
    assert.equal(view?.steps[1].state, "error");
    assert.equal(view?.steps[1].label, "Déjà prête");
  });

  it("agrees the cached label with the step", () => {
    assert.equal(
      loaderFromEtape({ id: "telechargement", cache: "deja_pret" })?.steps[0].label,
      "Déjà prêt"
    );
    assert.equal(
      loaderFromEtape({ id: "transcription", cache: "deja_pret" })?.steps[1].label,
      "Déjà prête"
    );
    assert.equal(
      loaderFromEtape({ id: "telechargement", cache: "deja_pret" }, "en")?.steps[0].label,
      "Already ready"
    );
  });
});

describe("showCreationCountDuringPartial", () => {
  it("keeps Clip N of M above the grid once a clip exists", () => {
    assert.equal(
      showCreationCountDuringPartial({
        status: "processing",
        hasPartialClips: true,
        etape: { id: "creation", clip: 1, sur: 4 },
      }),
      true
    );
    assert.equal(
      showCreationCountDuringPartial({
        status: "processing",
        hasPartialClips: false,
        etape: { id: "creation", clip: 1, sur: 4 },
      }),
      false
    );
    assert.equal(
      showCreationCountDuringPartial({
        status: "done",
        hasPartialClips: true,
        etape: { id: "creation", clip: 1, sur: 4 },
      }),
      false
    );
  });
});
