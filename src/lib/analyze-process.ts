/**
 * Logique de traitement des analyses en arrière-plan.
 * Utilisée par after() dans POST /api/analyze et par POST /api/analyze/process.
 *
 * Quand opts est fourni (depuis POST /api/analyze), on évite le SELECT car after()
 * peut tourner dans un contexte où l'admin client ne voit pas la row fraîchement insérée.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { runAnalysis } from "@/lib/analysis";
import {
  logProcessStart,
  logProcessStep,
  logProcessError,
  verifyAdminCanReadAnalyses,
  verifyAdminSeesRow,
} from "@/lib/analyze-diagnostics";

const RETRY_DELAY_MS = 500;
const MAX_FETCH_RETRIES = 3;

export type ProcessAnalysisOpts = {
  videoId: string;
  userId: string;
};

export async function processAnalysisInBackground(
  analysisId: string,
  opts?: ProcessAnalysisOpts
): Promise<void> {
  logProcessStart(analysisId, !!opts);

  const admin = createAdminClient();

  const adminReadCheck = await verifyAdminCanReadAnalyses(admin);
  logProcessStep("admin peut lire analyses", adminReadCheck.ok, adminReadCheck.detail);
  if (!adminReadCheck.ok) {
    logProcessError("admin read check", adminReadCheck.detail);
  }

  let videoId: string;
  let userId: string;

  if (opts) {
    // Données passées directement depuis la route — pas de SELECT (évite le bug after())
    videoId = opts.videoId;
    userId = opts.userId;
  } else {
    // Fallback pour /api/analyze/process : fetch la row
    await new Promise((r) => setTimeout(r, 300));
    const rowCheck = await verifyAdminSeesRow(admin, analysisId);
    logProcessStep("admin voit la row (fallback)", rowCheck.ok, rowCheck.detail);

    type AnalysisRow = { video_id: string; user_id: string; status: string };
    let row: AnalysisRow | null = null;
    for (let attempt = 0; attempt < MAX_FETCH_RETRIES; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      const { data, error } = await admin
        .from("analyses")
        .select("video_id, user_id, status")
        .eq("id", analysisId)
        .single();
      if (!error && data) {
        row = data as AnalysisRow;
        logProcessStep(`fetch row attempt ${attempt + 1}`, true);
        break;
      }
      logProcessStep(`fetch row attempt ${attempt + 1}`, false, error ? String(error) : "no data");
    }
    if (!row) {
      logProcessError("analysis not found after retries", analysisId);
      await admin
        .from("analyses")
        .update({
          status: "failed",
          error_message: "Erreur lors du démarrage de l'analyse. Réessaie.",
        })
        .eq("id", analysisId);
      return;
    }
    if (row.status !== "pending") return;
    videoId = row.video_id as string;
    userId = row.user_id as string;
  }

  try {
    const { error: processingErr } = await admin
      .from("analyses")
      .update({ status: "processing" })
      .eq("id", analysisId)
      .select("id")
      .single();

    logProcessStep("update status=processing", !processingErr, processingErr ? String(processingErr) : undefined);
    if (processingErr) throw processingErr;

    const { diagnosis, videoData } = await runAnalysis(videoId);
    logProcessStep("runAnalysis", true);

    const result = {
      diagnosis,
      videoData,
    };

    const { error: updateError } = await admin
      .from("analyses")
      .update({
        video_title: videoData.title,
        video_thumbnail: `https://img.youtube.com/vi/${videoId}/sddefault.jpg`,
        view_count: videoData.viewCount,
        subscriber_count: videoData.subscriberCount,
        score: diagnosis.score,
        result,
        status: "completed",
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", analysisId)
      .select("id")
      .single();

    logProcessStep("update status=completed", !updateError, updateError ? String(updateError) : undefined);
    if (updateError) {
      logProcessError("update completed", updateError);
      throw updateError;
    }

    const { data: profile } = await admin
      .from("profiles")
      .select("analyses_used")
      .eq("id", userId)
      .single();

    if (profile) {
      await admin
        .from("profiles")
        .update({ analyses_used: (profile.analyses_used ?? 0) + 1 })
        .eq("id", userId);
    }
  } catch (err) {
    logProcessError("catch", err);

    const message = err instanceof Error ? err.message : "Unknown error";
    let userMessage = "Erreur lors de l'analyse.";

    if (message === "QUOTA_EXCEEDED") userMessage = "Réessaie dans quelques minutes.";
    if (message === "VIDEO_NOT_FOUND") userMessage = "Vidéo privée, supprimée ou indisponible.";
    if (message === "YOUTUBE_API_ERROR") userMessage = "Réessaie dans quelques minutes.";
    if (message === "OPENAI_API_ERROR") userMessage = "Erreur lors de l'analyse.";

    const { error: failErr } = await admin
      .from("analyses")
      .update({
        status: "failed",
        error_message: userMessage,
      })
      .eq("id", analysisId)
      .select("id")
      .single();

    logProcessStep("update status=failed (on error)", !failErr, failErr ? String(failErr) : undefined);
  }
}
