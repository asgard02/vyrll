/**
 * Vérifications et logs pour diagnostiquer les problèmes d'analyse.
 * Préfixe [ANALYZE-DIAG] pour filtrer facilement dans les logs.
 */

const PREFIX = "[ANALYZE-DIAG]";

function log(step: string, data?: Record<string, unknown>) {
  const ts = new Date().toISOString();
  console.log(PREFIX, ts, step, data ?? "");
}

export function logRouteBeforeAfter(analysisId: string, videoId: string, userId: string, source: "insert" | "update") {
  log("route: avant after()", { analysisId, videoId, userId, source });
}

export function logProcessStart(analysisId: string, hasOpts: boolean) {
  log("process: démarrage", { analysisId, hasOpts });
}

export function logProcessStep(step: string, ok: boolean, detail?: string) {
  log(`process: ${step}`, { ok, detail });
}

export function logProcessError(step: string, err: unknown) {
  log(`process: ERREUR ${step}`, {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
}

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Vérifie que le client admin peut se connecter et lire la table analyses.
 * Retourne { ok, detail }.
 */
export async function verifyAdminCanReadAnalyses(admin: SupabaseClient): Promise<{ ok: boolean; detail: string }> {
  try {
    const { data, error } = await admin.from("analyses").select("id").limit(1);
    if (error) {
      return { ok: false, detail: `SELECT error: ${error.message} (code: ${(error as { code?: string }).code})` };
    }
    return { ok: true, detail: data ? "admin peut lire analyses" : "table vide ou 0 rows" };
  } catch (e) {
    return { ok: false, detail: `exception: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * Vérifie qu'une row existe pour l'admin (SELECT par id).
 */
export async function verifyAdminSeesRow(admin: SupabaseClient, analysisId: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const { data, error } = await admin.from("analyses").select("id, status").eq("id", analysisId).single();
    if (error) {
      return { ok: false, detail: `SELECT by id: ${error.message} (code: ${(error as { code?: string }).code})` };
    }
    return { ok: true, detail: data ? `row trouvée, status=${(data as { status?: string }).status}` : "pas de data" };
  } catch (e) {
    return { ok: false, detail: `exception: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * Vérifie la config env (sans exposer les secrets).
 */
export function verifyEnvConfig(): { ok: boolean; details: string[] } {
  const details: string[] = [];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) details.push("NEXT_PUBLIC_SUPABASE_URL manquant");
  else details.push(`URL: ${url.slice(0, 30)}...`);

  if (!serviceKey) details.push("SUPABASE_SERVICE_ROLE_KEY manquant");
  else {
    const prefix = serviceKey.slice(0, 20);
    const isJwt = serviceKey.startsWith("eyJ");
    details.push(`service_role: ${prefix}... (JWT: ${isJwt})`);
  }

  if (!anonKey) details.push("NEXT_PUBLIC_SUPABASE_*_KEY manquant");
  else details.push("anon key présent");

  return {
    ok: !!url && !!serviceKey && !!anonKey,
    details,
  };
}
