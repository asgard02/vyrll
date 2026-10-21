import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { postMomentChoice, postMomentPause } from "./moments-http.ts";
import type { MomentJobLoad, MomentsAdmin, PauseJobLoad } from "./moments-http.ts";

const JOB = "11111111-1111-4111-8111-111111111111";
const USER = "user-1";
const BACKEND = "backend-1";

type Pipeline = Record<string, unknown>;
type Filter = [string, string, string, unknown];

function readyPipeline(extra: Pipeline = {}): Pipeline {
  return {
    etape: "moments_prets",
    moments_prets_at: "2026-10-21T10:00:00.000Z",
    moments: [
      { debut: 1, fin: 2, titre: "a", score: 9, pourquoi: "p" },
      { debut: 3, fin: 4, titre: "b", score: 4, pourquoi: "q" },
    ],
    ...extra,
  };
}

function choiceLoad(pipeline: Pipeline, backendJobId: string | null = BACKEND): MomentJobLoad {
  return {
    kind: "ready",
    userId: USER,
    job: { id: JOB, backend_job_id: backendJobId, pipeline },
  };
}

function pauseLoad(pipeline: Pipeline): PauseJobLoad {
  return { kind: "ready", userId: USER, job: { id: JOB, pipeline } };
}

function scriptedAdmin(initial: Pipeline) {
  const state: { pipeline: Pipeline; race: null | (() => void) } = {
    pipeline: structuredClone(initial),
    race: null,
  };
  const updates: { filters: Filter[]; patch: Pipeline }[] = [];

  function apply(filters: Filter[], patch: Pipeline) {
    if (state.race) {
      state.race();
      state.race = null;
    }
    updates.push({ filters, patch });
    const etapeFiltered = filters.some(
      (filter) =>
        filter[0] === "filter" &&
        filter[1] === "pipeline->>etape" &&
        filter[2] === "eq" &&
        filter[3] === "moments_prets"
    );
    const chosenAbsent = filters.some(
      (filter) =>
        filter[0] === "filter" &&
        filter[1] === "pipeline->>moments_choisis" &&
        filter[2] === "is" &&
        filter[3] === null
    );
    const pauseAbsent = filters.some(
      (filter) =>
        filter[0] === "filter" &&
        filter[1] === "pipeline->>choix_en_cours_at" &&
        filter[2] === "is" &&
        filter[3] === null
    );
    const current = state.pipeline;
    const chosenFree = !Array.isArray(current.moments_choisis) || current.moments_choisis.length === 0;
    const pauseFree = current.choix_en_cours_at == null || current.choix_en_cours_at === "";
    let ok = etapeFiltered && current.etape === "moments_prets";
    if (chosenAbsent) ok = ok && chosenFree;
    if (pauseAbsent) ok = ok && pauseFree;
    if (!ok) return { data: [], error: null };
    state.pipeline = patch;
    return { data: [{ id: JOB }], error: null };
  }

  const admin = {
    from() {
      return {
        update(values: { pipeline: Pipeline }) {
          const filters: Filter[] = [];
          return {
            eq(column: string, value: string) {
              filters.push(["eq", column, "eq", value]);
              return this;
            },
            filter(column: string, operator: string, value: string | null) {
              filters.push(["filter", column, operator, value]);
              return this;
            },
            select() {
              return Promise.resolve(apply(filters, values.pipeline));
            },
            maybeSingle() {
              return Promise.resolve({ data: { pipeline: state.pipeline }, error: null });
            },
          };
        },
        select() {
          return {
            eq() {
              return this;
            },
            filter() {
              return this;
            },
            select() {
              return this;
            },
            maybeSingle() {
              return Promise.resolve({ data: { pipeline: state.pipeline }, error: null });
            },
          };
        },
      };
    },
  } as MomentsAdmin;

  return { admin, state, updates };
}

describe("POST /api/clips/[jobId]/moments", () => {
  it("rejects an anonymous, missing, or unconfigured caller", async () => {
    assert.equal((await postMomentChoice({ kind: "anonymous" }, null)).status, 401);
    assert.equal((await postMomentChoice({ kind: "missing" }, null)).status, 404);
    assert.equal((await postMomentChoice({ kind: "unconfigured" }, null)).status, 503);
  });

  it("stores the chosen moments once and enqueues a single render", async () => {
    const db = scriptedAdmin(readyPipeline());
    const enqueued: string[] = [];
    const enqueue = async (id: string) => {
      enqueued.push(id);
      return true;
    };
    const body = { moments: [{ debut: 3, fin: 4 }] };
    const first = await postMomentChoice(choiceLoad(readyPipeline()), body, {
      admin: db.admin,
      enqueue,
    });
    const second = await postMomentChoice(choiceLoad(db.state.pipeline), body, {
      admin: db.admin,
      enqueue,
    });

    assert.equal(first.status, 200);
    assert.equal(first.body.started, true);
    assert.deepEqual(enqueued, [BACKEND]);
    assert.equal(second.status, 200);
    assert.equal(second.body.started, false);
    assert.deepEqual(enqueued, [BACKEND]);
    assert.equal(db.updates.length, 1);
    const chosen = db.state.pipeline.moments_choisis as { titre: string }[];
    assert.equal(chosen[0].titre, "b");
    const filters = db.updates[0].filters;
    assert.equal(
      filters.some(
        (filter) =>
          filter[1] === "pipeline->>moments_choisis" && filter[2] === "is" && filter[3] === null
      ),
      true
    );
    assert.equal(
      filters.some((filter) => filter[0] === "eq" && filter[1] === "user_id" && filter[3] === USER),
      true
    );
  });

  it("does not enqueue when the moment is unknown, the list is empty, or the step is wrong", async () => {
    const db = scriptedAdmin(readyPipeline());
    const enqueued: string[] = [];
    const enqueue = async () => {
      enqueued.push("x");
      return true;
    };
    const unknown = await postMomentChoice(
      choiceLoad(readyPipeline()),
      { moments: [{ debut: 9, fin: 10 }] },
      { admin: db.admin, enqueue }
    );
    const empty = await postMomentChoice(choiceLoad(readyPipeline()), { moments: [] }, {
      admin: db.admin,
      enqueue,
    });
    const wrong = await postMomentChoice(
      choiceLoad(readyPipeline({ etape: "reperage" })),
      { moments: [{ debut: 1, fin: 2 }] },
      { admin: db.admin, enqueue }
    );
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.error, "Moment inconnu.");
    assert.equal(empty.status, 400);
    assert.equal(empty.body.error, "Liste vide.");
    assert.equal(wrong.status, 409);
    assert.equal(db.updates.length, 0);
    assert.deepEqual(enqueued, []);
  });

  it("returns started false without a second enqueue when the choice was just saved", async () => {
    const db = scriptedAdmin(readyPipeline());
    db.state.race = () => {
      db.state.pipeline = {
        ...db.state.pipeline,
        moments_choisis: [{ debut: 1, fin: 2, titre: "a", score: 9, pourquoi: "p" }],
      };
    };
    const enqueued: string[] = [];
    const result = await postMomentChoice(
      choiceLoad(readyPipeline()),
      { moments: [{ debut: 1, fin: 2 }] },
      {
        admin: db.admin,
        enqueue: async (id) => {
          enqueued.push(id);
          return true;
        },
      }
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.started, false);
    assert.deepEqual(enqueued, []);
    assert.equal(db.updates.length, 1);
  });
});

describe("POST /api/clips/[jobId]/moments/en-cours", () => {
  it("rejects an anonymous caller and the wrong step", async () => {
    assert.equal((await postMomentPause({ kind: "anonymous" })).status, 401);
    const db = scriptedAdmin(readyPipeline({ etape: "creation" }));
    const wrong = await postMomentPause(pauseLoad(readyPipeline({ etape: "creation" })), {
      admin: db.admin,
    });
    assert.equal(wrong.status, 409);
    assert.equal(db.updates.length, 0);
  });

  it("returns the server timestamp and does not write it twice", async () => {
    const db = scriptedAdmin(readyPipeline());
    const at = new Date("2026-10-21T10:04:00.000Z");
    const first = await postMomentPause(pauseLoad(readyPipeline()), {
      admin: db.admin,
      now: () => at,
    });
    const second = await postMomentPause(pauseLoad(db.state.pipeline), {
      admin: db.admin,
      now: () => new Date("2026-10-21T10:09:00.000Z"),
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.choix_en_cours_at, "2026-10-21T10:04:00.000Z");
    assert.equal(db.state.pipeline.choix_en_cours_at, "2026-10-21T10:04:00.000Z");
    assert.equal(Array.isArray(db.state.pipeline.moments), true);
    assert.equal(second.body.choix_en_cours_at, "2026-10-21T10:04:00.000Z");
    assert.equal(db.updates.length, 1);
    assert.equal(
      db.updates[0].filters.some(
        (filter) =>
          filter[1] === "pipeline->>choix_en_cours_at" && filter[2] === "is" && filter[3] === null
      ),
      true
    );
  });

  it("returns the timestamp already stored when the pause lands first", async () => {
    const db = scriptedAdmin(readyPipeline());
    const kept = "2026-10-21T10:04:01.000Z";
    db.state.race = () => {
      db.state.pipeline = { ...db.state.pipeline, choix_en_cours_at: kept };
    };
    const result = await postMomentPause(pauseLoad(readyPipeline()), {
      admin: db.admin,
      now: () => new Date("2026-10-21T10:04:00.000Z"),
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.choix_en_cours_at, kept);
    assert.equal(db.state.pipeline.moments_choisis, undefined);
  });
});
