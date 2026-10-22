import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FLUX_ETAPES,
  JOB_ETAPES,
  defaultMomentsChoisis,
  mergePipelineState,
  momentChoiceDue,
  momentsFromDetected,
  parkedRenderEnqueueAllowed,
  pipelineUpdate,
  replacementMatchesChoice,
  chosenClipsForRender,
  renderTotalForChoice,
  selectMomentsForRender,
  stepPatch,
  writeJobPipeline,
} from "./job-pipeline.js";

const FRONTEND_ID = "11111111-1111-4111-8111-111111111111";

function recordingClient(writes) {
  return {
    from(table) {
      return {
        update(payload) {
          writes.push({ table, payload });
          return {
            eq() {
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
}

describe("writeJobPipeline", () => {
  it("updates only pipeline and leaves an existing clips array untouched", async () => {
    const clips = [
      { url: "https://cdn.example/a.mp4", text: "un" },
      { url: "https://cdn.example/b.mp4", text: "deux" },
    ];
    const job = { clips, pipelineState: null };
    const detected = [
      { start: 12.4, end: 40, hook: "Le titre", score: 8, reason: "la chute" },
      { sourceStart: 80, sourceEnd: 110, hook: "Deux", score_viral: 6, reason: "la suite" },
    ];
    let state = mergePipelineState(
      job.pipelineState,
      stepPatch("reperage", { moments: momentsFromDetected(detected) })
    );
    state = { ...state, clips: job.clips };
    const writes = [];
    await writeJobPipeline(recordingClient(writes), FRONTEND_ID, state, "backend-1");
    state = mergePipelineState(state, stepPatch("creation", { clip: 2, sur: 5 }));
    await writeJobPipeline(recordingClient(writes), FRONTEND_ID, state, "backend-1");

    assert.equal(writes.length, 2);
    for (const write of writes) {
      assert.equal(write.table, "clip_jobs");
      assert.deepEqual(Object.keys(write.payload), ["pipeline"]);
      assert.equal(Object.prototype.hasOwnProperty.call(write.payload, "clips"), false);
      assert.equal(write.payload.pipeline.clips, undefined);
    }
    assert.equal(writes[1].payload.pipeline.etape, "creation");
    assert.equal(writes[1].payload.pipeline.clip, 2);
    assert.equal(writes[1].payload.pipeline.sur, 5);
    assert.equal(writes[1].payload.pipeline.moments.length, 2);
    assert.equal(writes[1].payload.pipeline.moments[0].titre, "Le titre");
    assert.equal(writes[1].payload.pipeline.moments[0].pourquoi, "la chute");
    assert.equal(writes[1].payload.pipeline.moments[0].debut, 12.4);
    assert.equal(writes[1].payload.pipeline.moments[1].score, 6);
    assert.equal(job.clips.length, 2);
    assert.equal(job.clips[0].url, "https://cdn.example/a.mp4");
    assert.equal(job.clips[1].text, "deux");
  });

  it("does not call update when frontend_job_id is missing", async () => {
    const writes = [];
    const result = await writeJobPipeline(
      recordingClient(writes),
      null,
      stepPatch("transcription", { cache: "deja_pret" }),
      "backend-2"
    );
    assert.equal(result.wrote, false);
    assert.equal(writes.length, 0);
  });

  it("keeps the failed step and never adds clips to the patch", () => {
    const state = mergePipelineState(mergePipelineState(null, stepPatch("telechargement")), {
      echec: true,
      clips: [{ url: "nope" }],
    });
    const patch = pipelineUpdate(state);
    assert.deepEqual(Object.keys(patch), ["pipeline"]);
    assert.equal(patch.pipeline.etape, "telechargement");
    assert.equal(patch.pipeline.echec, true);
    assert.equal(patch.pipeline.clips, undefined);
  });
});

describe("etapes", () => {
  it("writes moments_prets between spotting and creation", () => {
    assert.equal(JOB_ETAPES.includes("moments_prets"), true);
    assert.deepEqual([...FLUX_ETAPES], [
      "telechargement",
      "transcription",
      "reperage",
      "moments_prets",
      "creation",
    ]);
    assert.equal(pipelineUpdate({ etape: "moments_prets" }).pipeline.etape, "moments_prets");
  });

  it("keeps the choice when creation starts", () => {
    const ready = "2026-10-21T10:00:00.000Z";
    let state = mergePipelineState(
      null,
      stepPatch("moments_prets", {
        moments: [{ debut: 1, fin: 2, score: 4, titre: "a", pourquoi: "p" }],
        moments_prets_at: ready,
        clips_demandes: 3,
        choix_en_cours_at: "2026-10-21T10:01:00.000Z",
        moments_choisis: [{ debut: 1, fin: 2, score: 4, titre: "a", pourquoi: "p" }],
      })
    );
    state = mergePipelineState(state, stepPatch("creation", { clip: 1, sur: 1 }));
    assert.equal(state.etape, "creation");
    assert.equal(state.clip, 1);
    assert.equal(state.sur, 1);
    assert.equal(state.moments_choisis.length, 1);
    assert.equal(state.clips_demandes, 3);
    assert.equal(state.moments_prets_at, ready);
    assert.equal(state.choix_en_cours_at, "2026-10-21T10:01:00.000Z");
    assert.equal(Object.prototype.hasOwnProperty.call(
      mergePipelineState(null, stepPatch("reperage")),
      "moments_choisis"
    ), false);
  });
});

describe("selectMomentsForRender", () => {
  const detected = [
    { start: 1, end: 10, hook: "a" },
    { start: 20, end: 30, hook: "b" },
    { sourceStart: 40, sourceEnd: 50, hook: "c" },
  ];

  it("keeps the detected windows when no choice is given", () => {
    assert.equal(selectMomentsForRender(detected, undefined), detected);
    assert.equal(selectMomentsForRender(detected, null), detected);
    assert.equal(selectMomentsForRender(detected, []), detected);
  });

  it("keeps only the chosen windows, in the chosen order", () => {
    const picked = selectMomentsForRender(detected, [
      { debut: 40, fin: 50 },
      { debut: 1, fin: 10 },
    ]);
    assert.deepEqual(
      picked.map((item) => item.hook),
      ["c", "a"]
    );
  });

  it("drops every window when the choice matches none of them", () => {
    assert.deepEqual(selectMomentsForRender(detected, [{ debut: 3, fin: 4 }]), []);
  });

  it("renders one clip when one was requested and one was chosen", () => {
    const detectedTwo = [
      { start: 50.28, end: 67.24, hook: "auto" },
      { start: 114.8, end: 133.76, hook: "chosen" },
    ];
    const chosen = [{ debut: 114.8, fin: 133.76 }];
    const rendered = chosenClipsForRender(detectedTwo, chosen, 1);
    assert.deepEqual(
      rendered.map((item) => item.hook),
      ["chosen"]
    );
    assert.equal(rendered.length, 1);
  });

  it("matches a window within 0.05s and drops the rest", () => {
    const picked = selectMomentsForRender(detected, [
      { debut: 1.05, fin: 10.05 },
      { debut: 20.06, fin: 30.06 },
    ]);
    assert.deepEqual(
      picked.map((item) => item.hook),
      ["a"]
    );
  });
});

describe("moment choice", () => {
  const moments = [
    { debut: 1, fin: 2, score: 5, titre: "a", pourquoi: "" },
    { debut: 3, fin: 4, score: 9, titre: "b", pourquoi: "" },
    { debut: 5, fin: 6, score: 9, titre: "c", pourquoi: "" },
  ];

  it("prechecks the highest scores and keeps the original order on a tie", () => {
    assert.deepEqual(
      defaultMomentsChoisis(moments, 2).map((moment) => moment.titre),
      ["b", "c"]
    );
  });

  it("counts sur from the chosen windows", () => {
    assert.equal(renderTotalForChoice(2, 5, [{ debut: 1, fin: 2 }]), 2);
    assert.equal(renderTotalForChoice(4, 1, [{ debut: 1, fin: 2 }]), 1);
    assert.equal(renderTotalForChoice(4, 2, []), 2);
  });

  it("refuses a replacement that was not chosen", () => {
    assert.equal(replacementMatchesChoice({ start: 1, end: 2 }, []), true);
    assert.equal(
      replacementMatchesChoice({ start: 1.04, end: 2.04 }, [{ debut: 1, fin: 2 }]),
      true
    );
    assert.equal(
      replacementMatchesChoice({ start: 9, end: 10 }, [{ debut: 1, fin: 2 }]),
      false
    );
  });

  it("waits 10 minutes, or 30 after a checkbox pause", () => {
    const ready = "2026-10-21T10:00:00.000Z";
    const readyMs = Date.parse(ready);
    assert.equal(momentChoiceDue({ moments_prets_at: ready }, readyMs + 10 * 60 * 1000 - 1), false);
    assert.equal(momentChoiceDue({ moments_prets_at: ready }, readyMs + 10 * 60 * 1000), true);
    assert.equal(
      momentChoiceDue(
        { moments_prets_at: ready, choix_en_cours_at: "2026-10-21T10:04:00.000Z" },
        readyMs + 10 * 60 * 1000
      ),
      false
    );
    assert.equal(
      momentChoiceDue(
        { moments_prets_at: ready, choix_en_cours_at: "2026-10-21T10:04:00.000Z" },
        readyMs + 30 * 60 * 1000
      ),
      true
    );
  });

  it("enqueues a parked row once, and refuses a second claim", () => {
    const parked = {
      status: "processing",
      claimed_by: null,
      payload: { phase: "moments_prets" },
    };
    assert.equal(parkedRenderEnqueueAllowed(parked), true);
    assert.equal(
      parkedRenderEnqueueAllowed({ ...parked, claimed_by: "worker-1" }),
      false
    );
    assert.equal(parkedRenderEnqueueAllowed({ ...parked, status: "pending" }), false);
    assert.equal(
      parkedRenderEnqueueAllowed({
        ...parked,
        payload: { phase: "render" },
      }),
      true
    );
    assert.equal(
      parkedRenderEnqueueAllowed({
        status: "pending",
        claimed_by: null,
        payload: { phase: "render" },
      }),
      false
    );
  });
});
