import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CLIP_BACKEND_JOB_STATUSES,
  CLAIM_DEFAULT_MOMENTS_RPC,
  MOMENT_SCAN_PHASE_FILTER,
  applyDefaultMomentsClaim,
  clipBackendJobStatus,
  parkJobForMomentChoice,
  resolveQueueScope,
  scanParkedMomentJobs,
} from "./moment-park.js";

const READY = "2026-10-21T10:00:00.000Z";
const READY_MS = Date.parse(READY);
const AT_10 = READY_MS + 10 * 60 * 1000;
const AT_30 = READY_MS + 30 * 60 * 1000;
const PAUSE = "2026-10-21T10:09:00.000Z";

function jobId(n) {
  return `11111111-1111-4111-8111-${n.toString(16).padStart(12, "0")}`;
}

function pipeline(extra = {}) {
  return {
    etape: "moments_prets",
    moments_prets_at: READY,
    clips_demandes: 1,
    extra: "keep",
    moments: [
      { debut: 1, fin: 2, titre: "low", score: 1, pourquoi: "" },
      { debut: 3, fin: 4, titre: "high", score: 9, pourquoi: "" },
    ],
    ...extra,
  };
}

function clipRow(id, extra = {}) {
  return {
    id,
    status: "processing",
    pipeline: pipeline(extra),
  };
}

function backendRow(id, frontendId, phase, scope = "local") {
  return {
    backend_job_id: `backend-${id}`,
    status: "processing",
    claimed_by: null,
    payload: {
      phase,
      queue_scope: scope,
      frontend_job_id: frontendId,
    },
  };
}

function scriptedDb(options = {}) {
  const clips = new Map(options.clips || []);
  const state = {
    backend: options.backend || [],
    now: options.now ?? AT_10,
    injectPause: options.injectPause === true,
    rpc: [],
    query: null,
  };
  const released = [];

  function backendQuery() {
    const query = {
      status: null,
      claimed: undefined,
      phaseFilter: null,
      limited: null,
      select() {
        return this;
      },
      eq(column, value) {
        if (column === "status") this.status = value;
        return this;
      },
      is(column, value) {
        if (column === "claimed_by") this.claimed = value;
        return this;
      },
      or(filter) {
        this.phaseFilter = filter;
        return this;
      },
      limit(count) {
        this.limited = count;
        return this;
      },
      then(resolve, reject) {
        state.query = this;
        let rows = state.backend.filter((row) => {
          if (this.status && row.status !== this.status) return false;
          if (this.claimed === null && row.claimed_by) return false;
          if (this.phaseFilter === MOMENT_SCAN_PHASE_FILTER) {
            const phase = row.payload?.phase;
            if (phase !== "moments_prets" && phase !== "render") return false;
          }
          return true;
        });
        if (this.limited != null) rows = rows.slice(0, this.limited);
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return query;
  }

  function clipQuery() {
    const query = {
      id: null,
      select() {
        return this;
      },
      eq(column, value) {
        if (column === "id") this.id = value;
        return this;
      },
      maybeSingle() {
        return Promise.resolve({ data: clips.get(this.id) || null, error: null });
      },
      update() {
        throw new Error("claim must not replace the pipeline");
      },
    };
    return query;
  }

  const supabase = {
    from(table) {
      if (table === "clip_backend_jobs") return backendQuery();
      if (table === "clip_jobs") return clipQuery();
      throw new Error(`unexpected table ${table}`);
    },
    async rpc(name, args) {
      assert.equal(name, CLAIM_DEFAULT_MOMENTS_RPC);
      assert.deepEqual(Object.keys(args).sort(), ["p_chosen", "p_job_id"]);
      state.rpc.push(args);
      const row = clips.get(args.p_job_id);
      if (state.injectPause) {
        row.pipeline = { ...row.pipeline, choix_en_cours_at: PAUSE };
      }
      const next = applyDefaultMomentsClaim(row, args.p_chosen, state.now);
      if (!next) return { data: false, error: null };
      row.pipeline = next;
      return { data: true, error: null };
    },
  };

  return { supabase, clips, state, released };
}

async function scan(db, scope = "local") {
  await scanParkedMomentJobs(db.supabase, {
    scope,
    now: db.state.now,
    release: async (id) => {
      db.released.push(id);
      return true;
    },
  });
}

describe("parkJobForMomentChoice", () => {
  it("keeps a local queue from the stored payload and never writes parked", async () => {
    const job = { status: "processing", url: "https://youtu.be/abc" };
    const persisted = [];
    let forgotten = null;
    await parkJobForMomentChoice(job, "job-1", {
      readPayload: async () => ({ queue_scope: "local", url: "https://youtu.be/stored" }),
      payloadFromJob: () => ({ url: "https://youtu.be/abc", queue_scope: "production", phase: null }),
      persist: async (_id, patch) => {
        persisted.push(patch);
      },
      forget: (id) => {
        forgotten = id;
      },
    });

    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].status, "processing");
    assert.equal(CLIP_BACKEND_JOB_STATUSES.includes(persisted[0].status), true);
    assert.equal(persisted[0].payload.queue_scope, "local");
    assert.equal(persisted[0].payload.phase, "moments_prets");
    assert.equal(persisted[0].payload.url, "https://youtu.be/abc");
    assert.equal(persisted[0].claimed_by, null);
    assert.equal(job.status, "processing");
    assert.equal(job.awaitingMomentChoice, true);
    assert.equal(forgotten, "job-1");
  });

  it("prefers the stored payload over the in-memory queue", () => {
    assert.equal(
      resolveQueueScope({ queue_scope: "local" }, { queue_scope: "production" }),
      "local"
    );
  });

  it("uses the in-memory queue when the stored payload has none", async () => {
    const job = { status: "processing", queue_scope: "local" };
    const persisted = [];
    await parkJobForMomentChoice(job, "job-2", {
      readPayload: async () => ({}),
      payloadFromJob: () => ({ queue_scope: "production" }),
      persist: async (_id, patch) => {
        persisted.push(patch);
      },
      forget: () => {},
    });
    assert.equal(persisted[0].payload.queue_scope, "local");
    assert.equal(job.status, "processing");
  });
});

describe("clip backend status", () => {
  it("never returns a status outside the check", () => {
    assert.equal(clipBackendJobStatus("parked", "processing"), "processing");
    assert.equal(clipBackendJobStatus("parked", "parked"), "pending");
    assert.equal(clipBackendJobStatus("done", "pending"), "done");
    for (const status of CLIP_BACKEND_JOB_STATUSES) {
      assert.equal(clipBackendJobStatus(status, "pending"), status);
    }
  });
});

describe("scanParkedMomentJobs", () => {
  it("filters on the parked and render phases and does not stop at 40", async () => {
    const clips = [];
    const backend = [];
    for (let n = 1; n <= 41; n += 1) {
      const id = jobId(n);
      clips.push([id, clipRow(id)]);
      backend.push(backendRow(id, id, "moments_prets"));
    }
    const renderId = jobId(90);
    backend.push(backendRow(renderId, renderId, "render"));
    const otherId = jobId(91);
    clips.push([otherId, clipRow(otherId)]);
    backend.push(backendRow(otherId, otherId, "moments_prets", "production"));
    backend.push(backendRow(jobId(92), jobId(92), "creation"));

    const db = scriptedDb({ clips, backend, now: AT_10 });
    await scan(db);

    assert.equal(db.state.query.phaseFilter, MOMENT_SCAN_PHASE_FILTER);
    assert.equal(db.state.query.limited, null);
    assert.equal(db.state.query.status, "processing");
    assert.equal(db.state.query.claimed, null);
    assert.equal(db.released.includes(`backend-${jobId(41)}`), true);
    assert.equal(db.released.includes(`backend-${renderId}`), true);
    assert.equal(db.released.includes(`backend-${otherId}`), false);
    assert.equal(db.released.includes(`backend-${jobId(92)}`), false);
    assert.equal(db.state.rpc.length, 41);
    assert.equal(db.released.length, 42);
    const kept = db.clips.get(jobId(1)).pipeline;
    assert.equal(kept.extra, "keep");
    assert.equal(kept.moments.length, 2);
    assert.equal(kept.moments_choisis[0].titre, "high");
    assert.deepEqual(Object.keys(db.state.rpc[0]).sort(), ["p_chosen", "p_job_id"]);
  });

  it("writes nothing and waits out the 30 minute cap when the pause wins the race", async () => {
    const id = jobId(1);
    const db = scriptedDb({
      clips: [[id, clipRow(id)]],
      backend: [backendRow(id, id, "moments_prets")],
      now: AT_10,
      injectPause: true,
    });
    await scan(db);

    assert.equal(db.state.rpc.length, 1);
    assert.equal(db.released.length, 0);
    const kept = db.clips.get(id).pipeline;
    assert.equal(kept.choix_en_cours_at, PAUSE);
    assert.equal(kept.moments_choisis, undefined);
    assert.equal(kept.extra, "keep");
  });

  it("does not claim when the pause is already stored before the 30 minute cap", async () => {
    const id = jobId(2);
    const db = scriptedDb({
      clips: [[id, clipRow(id, { choix_en_cours_at: PAUSE })]],
      backend: [backendRow(id, id, "moments_prets")],
      now: AT_10,
    });
    await scan(db);
    assert.equal(db.state.rpc.length, 0);
    assert.equal(db.released.length, 0);
    assert.equal(db.clips.get(id).pipeline.moments_choisis, undefined);
  });

  it("claims only moments_choisis at the 30 minute cap and keeps the pause", async () => {
    const id = jobId(3);
    const db = scriptedDb({
      clips: [[id, clipRow(id, { choix_en_cours_at: PAUSE })]],
      backend: [backendRow(id, id, "moments_prets")],
      now: AT_30,
    });
    await scan(db);
    const kept = db.clips.get(id).pipeline;
    assert.equal(db.released.length, 1);
    assert.equal(kept.choix_en_cours_at, PAUSE);
    assert.equal(kept.extra, "keep");
    assert.equal(kept.moments_choisis[0].titre, "high");
    assert.equal(kept.moments.length, 2);
  });
});

describe("applyDefaultMomentsClaim", () => {
  it("returns null when a pause arrives before minute 10", () => {
    const row = clipRow(jobId(4));
    row.pipeline = { ...row.pipeline, choix_en_cours_at: PAUSE };
    assert.equal(applyDefaultMomentsClaim(row, row.pipeline.moments, AT_10), null);
    assert.equal(row.pipeline.moments_choisis, undefined);
  });
});
