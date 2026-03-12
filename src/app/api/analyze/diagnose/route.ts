/**
 * GET /api/analyze/diagnose
 * Vérifications pour diagnostiquer les problèmes d'analyse.
 * À appeler manuellement (ex: curl localhost:3000/api/analyze/diagnose)
 */
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  verifyEnvConfig,
  verifyAdminCanReadAnalyses,
  verifyAdminSeesRow,
} from "@/lib/analyze-diagnostics";

export async function GET() {
  const results: Record<string, unknown> = {};

  const envCheck = verifyEnvConfig();
  results.env = { ok: envCheck.ok, details: envCheck.details };

  try {
    const admin = createAdminClient();
    const adminRead = await verifyAdminCanReadAnalyses(admin);
    results.adminCanReadAnalyses = { ok: adminRead.ok, detail: adminRead.detail };

    const server = await createClient();
    const { data: { user } } = await server.auth.getUser();
    results.userAuthenticated = !!user;

    if (user) {
      const { data: analyses, error } = await server
        .from("analyses")
        .select("id, status, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(3);

      results.lastAnalysesFromUserClient = {
        ok: !error,
        error: error ? String(error) : null,
        count: analyses?.length ?? 0,
        ids: analyses?.map((a) => a.id) ?? [],
      };

      const lastId = analyses?.[0]?.id;
      if (lastId) {
        const adminSees = await verifyAdminSeesRow(admin, lastId);
        results.adminSeesLastAnalysis = { ok: adminSees.ok, detail: adminSees.detail };
      }
    }
  } catch (e) {
    results.error = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json(results, { status: 200 });
}
