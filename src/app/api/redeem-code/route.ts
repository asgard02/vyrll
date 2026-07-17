import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/supabase/server-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase";

type PromoCode =
  | { code: string; plan: string; analyses_limit: number; credits_limit?: number; reanalyze: false }
  | { code: string; reanalyze: true };

/**
 * Format: CODE:plan:analyses_limit  ou  CODE:plan:analyses_limit:credits_limit  ou  CODE:reanalyze
 * Ex: FLOPCREATOR:creator:20, FLOPSTUDIO:studio:999:210, FLOPREANALYSE:reanalyze
 * Requires PROMO_CODES env — no hardcoded fallback.
 */
function parsePromoCodes(): PromoCode[] {
  const raw = (process.env.PROMO_CODES ?? "").trim();
  if (!raw) return [];

  return raw.split(",").reduce<PromoCode[]>((acc, part) => {
    const parts = part.trim().split(":");
    const [code, plan, limitStr, creditsStr] = parts;
    if (!code) return acc;
    if (plan === "reanalyze") {
      acc.push({ code: code.toUpperCase(), reanalyze: true });
      return acc;
    }
    if (plan && limitStr) {
      const num = parseInt(limitStr, 10);
      const credits = creditsStr ? parseInt(creditsStr, 10) : undefined;
      if (!["free", "creator", "studio"].includes(plan)) return acc;
      acc.push({
        code: code.toUpperCase(),
        plan,
        analyses_limit: isNaN(num) ? (plan === "free" ? 5 : plan === "creator" ? 20 : 999) : num,
        credits_limit: credits,
        reanalyze: false,
      });
    }
    return acc;
  }, []);
}

export async function POST(request: NextRequest) {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json(
        { error: "Authentification non configurée." },
        { status: 503 }
      );
    }

    const supabase = await createClient();
    const { user } = await getServerUser(supabase);

    if (!user) {
      return NextResponse.json(
        { error: "Non authentifié." },
        { status: 401 }
      );
    }

    const rawCodes = (process.env.PROMO_CODES ?? "").trim();
    if (!rawCodes) {
      return NextResponse.json(
        { error: "Codes promo désactivés." },
        { status: 503 }
      );
    }

    const body = await request.json();
    const code = String(body?.code ?? "").trim().toUpperCase();

    if (!code) {
      return NextResponse.json(
        { error: "Code requis." },
        { status: 400 }
      );
    }

    const codes = parsePromoCodes();
    const match = codes.find((c) => c.code === code);

    if (!match) {
      return NextResponse.json(
        { error: "Code invalide ou expiré." },
        { status: 400 }
      );
    }

    const admin = createAdminClient();

    if (match.reanalyze) {
      const { error } = await admin
        .from("profiles")
        .update({ reanalyses_enabled: true })
        .eq("id", user.id);

      if (error) {
        console.error("Redeem code error:", error);
        return NextResponse.json(
          { error: "Erreur lors de l'application du code." },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        message: "Option activée sur ton compte.",
        reanalyses_enabled: true,
      });
    }

    const updatePayload: { plan: string; status: string; analyses_limit: number; credits_limit?: number } = {
      plan: match.plan,
      status: "active",
      analyses_limit: match.analyses_limit,
    };
    if (match.credits_limit != null) {
      updatePayload.credits_limit = match.credits_limit;
    } else if (match.plan === "free") {
      updatePayload.credits_limit = 30;
    } else if (match.plan === "creator") {
      updatePayload.credits_limit = 90;
    } else if (match.plan === "studio") {
      updatePayload.credits_limit = 210;
    }

    const { error } = await admin
      .from("profiles")
      .update(updatePayload)
      .eq("id", user.id);

    if (error) {
      console.error("Redeem code error:", error);
      return NextResponse.json(
        { error: "Erreur lors de l'application du code." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Plan ${match.plan} activé ! ${updatePayload.credits_limit ?? "—"} crédits vidéo.`,
      plan: match.plan,
      analyses_limit: match.analyses_limit,
      credits_limit: updatePayload.credits_limit,
    });
  } catch (err) {
    console.error("Redeem code API error:", err);
    return NextResponse.json(
      { error: "Erreur." },
      { status: 500 }
    );
  }
}
