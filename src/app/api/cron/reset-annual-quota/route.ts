import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase";

function authorizeCron(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const headerSecret = request.headers.get("x-cron-secret");
  return headerSecret === secret;
}

/**
 * Remet le quota mensuel des abos annuels (facture Stripe = 1× / an).
 * Auth : Authorization: Bearer CRON_SECRET (ou x-cron-secret).
 */
export async function GET(request: NextRequest) {
  try {
    if (!authorizeCron(request)) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    if (!isSupabaseConfigured()) {
      return NextResponse.json(
        { error: "Supabase non configuré." },
        { status: 503 }
      );
    }

    const cutoffMs = Date.now() - 28 * 24 * 60 * 60 * 1000;
    const admin = createAdminClient();
    const { data: annual, error: listError } = await admin
      .from("profiles")
      .select("id, quota_reset_at")
      .in("plan", ["creator", "studio"])
      .eq("billing_interval", "year");

    if (listError) throw listError;

    const dueIds = (annual ?? [])
      .filter((row) => {
        if (!row.quota_reset_at) return true;
        const resetAt = Date.parse(String(row.quota_reset_at));
        return Number.isFinite(resetAt) && resetAt <= cutoffMs;
      })
      .map((row) => row.id);

    if (dueIds.length === 0) {
      return NextResponse.json({ ok: true, reset: 0 });
    }

    const { data, error } = await admin
      .from("profiles")
      .update({
        credits_used: 0,
        analyses_used: 0,
        quota_reset_at: new Date().toISOString(),
      })
      .in("id", dueIds)
      .select("id");

    if (error) throw error;

    const reset = data?.length ?? 0;
    console.log(`[cron/reset-annual-quota] reset=${reset}`);
    return NextResponse.json({ ok: true, reset });
  } catch (err) {
    console.error("[cron/reset-annual-quota]", err);
    return NextResponse.json({ error: "Erreur." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
