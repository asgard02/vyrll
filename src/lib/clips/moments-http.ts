import { etapeFromPipeline } from "@/lib/clips/job-etape";
import {
  PAUSE_RENDER_STARTED,
  matchMomentChoice,
  momentSpansFromBody,
  pipelineChoosingAt,
  pipelineHasChosenMoments,
  pipelineObject,
} from "@/lib/clips/moments-choice";

export const PAUSE_MOMENT_RPC = "clip_jobs_pause_moment_choice";

export type MomentsHttpResult = {
  status: number;
  body: Record<string, unknown>;
};

type ChoiceJob = {
  id: string;
  backend_job_id: string | null;
  pipeline: unknown;
};

type PauseJob = {
  id: string;
  pipeline: unknown;
};

export type MomentJobLoad =
  | { kind: "unconfigured" }
  | { kind: "anonymous" }
  | { kind: "missing" }
  | { kind: "ready"; userId: string; job: ChoiceJob };

export type PauseJobLoad =
  | { kind: "unconfigured" }
  | { kind: "anonymous" }
  | { kind: "missing" }
  | { kind: "ready"; userId: string; job: PauseJob };

type QueryResult<T> = PromiseLike<{
  data: T;
  error: { message: string } | null;
}>;

type MomentsChain = {
  eq(column: string, value: string): MomentsChain;
  filter(column: string, operator: string, value: string | null): MomentsChain;
  select(columns: string): QueryResult<{ id: string }[] | null>;
  maybeSingle(): QueryResult<{ pipeline?: unknown } | null>;
};

export type MomentsAdmin = {
  from(table: string): {
    update(values: { pipeline: Record<string, unknown> }): MomentsChain;
    select(columns: string): MomentsChain;
  };
};

export type PauseAdmin = {
  rpc(
    fn: typeof PAUSE_MOMENT_RPC,
    args: { p_job_id: string; p_user_id: string; p_at: string }
  ): PromiseLike<{ data: boolean | null; error: { message: string } | null }>;
  from(table: string): {
    select(columns: string): MomentsChain;
  };
};

function gate(kind: MomentJobLoad["kind"]): MomentsHttpResult | null {
  switch (kind) {
    case "unconfigured":
      return { status: 503, body: { error: "Authentification non configurée." } };
    case "anonymous":
      return { status: 401, body: { error: "Non authentifié." } };
    case "missing":
      return { status: 404, body: { error: "Introuvable." } };
    case "ready":
      return null;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

export async function postMomentChoice(
  load: MomentJobLoad,
  body: unknown,
  deps?: {
    admin: MomentsAdmin;
    enqueue: (backendJobId: string) => Promise<boolean>;
  }
): Promise<MomentsHttpResult> {
  const blocked = gate(load.kind);
  if (blocked) return blocked;
  if (load.kind !== "ready" || !deps) return { status: 500, body: { error: "Erreur." } };
  const { userId, job } = load;
  const etape = etapeFromPipeline(job.pipeline);
  if (etape?.id !== "moments_prets") {
    return { status: 409, body: { error: "Mauvaise étape." } };
  }
  if (pipelineHasChosenMoments(job.pipeline)) {
    return { status: 200, body: { started: false } };
  }
  const spans = momentSpansFromBody(body);
  if (!spans) {
    return { status: 400, body: { error: "Corps invalide." } };
  }
  const matched = matchMomentChoice(etape.moments, spans);
  if (!matched.ok) {
    return {
      status: 400,
      body: { error: matched.reason === "unknown" ? "Moment inconnu." : "Liste vide." },
    };
  }
  if (etape.clips_demandes != null && matched.chosen.length > etape.clips_demandes) {
    return { status: 400, body: { error: "Trop de moments." } };
  }

  const pipeline = pipelineObject(job.pipeline) ?? {};
  pipeline.etape = "moments_prets";
  pipeline.moments_choisis = matched.chosen;

  const { data: updated, error } = await deps.admin
    .from("clip_jobs")
    .update({ pipeline })
    .eq("id", job.id)
    .eq("user_id", userId)
    .filter("pipeline->>etape", "eq", "moments_prets")
    .filter("pipeline->>moments_choisis", "is", null)
    .select("id");
  if (error) {
    console.error("[moments] choice update failed:", error);
    return { status: 500, body: { error: "Erreur." } };
  }
  if (!updated?.length) {
    const { data: again } = await deps.admin
      .from("clip_jobs")
      .select("pipeline")
      .eq("id", job.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (pipelineHasChosenMoments(again?.pipeline)) {
      return { status: 200, body: { started: false } };
    }
    return { status: 409, body: { error: "Mauvaise étape." } };
  }
  const started = job.backend_job_id ? await deps.enqueue(job.backend_job_id) : false;
  return { status: 200, body: { started } };
}

export async function postMomentPause(
  load: PauseJobLoad,
  deps?: { admin: PauseAdmin; now?: () => Date }
): Promise<MomentsHttpResult> {
  const blocked = gate(load.kind);
  if (blocked) return blocked;
  if (load.kind !== "ready" || !deps) return { status: 500, body: { error: "Erreur." } };
  const { userId, job } = load;
  const etape = etapeFromPipeline(job.pipeline);
  if (etape?.id !== "moments_prets") {
    return { status: 409, body: { error: "Mauvaise étape." } };
  }
  if (pipelineHasChosenMoments(job.pipeline)) {
    return { status: 409, body: { error: PAUSE_RENDER_STARTED } };
  }
  const existing = pipelineChoosingAt(job.pipeline);
  if (existing) {
    return { status: 200, body: { choix_en_cours_at: existing } };
  }

  const at = (deps.now ?? (() => new Date()))().toISOString();
  const { data, error } = await deps.admin.rpc(PAUSE_MOMENT_RPC, {
    p_job_id: job.id,
    p_user_id: userId,
    p_at: at,
  });
  if (error) {
    console.error("[moments] pause update failed:", error);
    return { status: 500, body: { error: "Erreur." } };
  }
  if (data === true) {
    return { status: 200, body: { choix_en_cours_at: at } };
  }

  const { data: again } = await deps.admin
    .from("clip_jobs")
    .select("pipeline")
    .eq("id", job.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (pipelineHasChosenMoments(again?.pipeline)) {
    return { status: 409, body: { error: PAUSE_RENDER_STARTED } };
  }
  const kept = pipelineChoosingAt(again?.pipeline);
  if (kept) return { status: 200, body: { choix_en_cours_at: kept } };
  return { status: 409, body: { error: "Mauvaise étape." } };
}
