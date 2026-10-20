import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FLUX_ETAPES,
  JOB_ETAPES,
  mergePipelineState,
  momentsFromDetected,
  pipelineUpdate,
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
  it("accepts moments_prets without emitting it in the job flow", () => {
    assert.equal(JOB_ETAPES.includes("moments_prets"), true);
    assert.equal(FLUX_ETAPES.includes("moments_prets"), false);
    assert.deepEqual([...FLUX_ETAPES], ["telechargement", "transcription", "reperage", "creation"]);
    assert.equal(pipelineUpdate({ etape: "moments_prets" }).pipeline.etape, "moments_prets");
    for (const etape of FLUX_ETAPES) {
      assert.notEqual(stepPatch(etape).etape, "moments_prets");
    }
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

  it("keeps the detected windows when nothing matches", () => {
    assert.equal(selectMomentsForRender(detected, [{ debut: 3, fin: 4 }]), detected);
  });
});
