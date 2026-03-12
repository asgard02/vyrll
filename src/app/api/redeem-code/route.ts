import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase";

type PromoCode =
  | { code: string; plan: string; analyses_limit: number; reanalyze: false }
  | { code: string; reanalyze: true };

/**
 * Format: CODE:plan:analyses_limit  ou  CODE:reanalyze
 * Ex: FLOPPRO:pro:50, FLOPUNLIMITED:unlimited:999, FLOPREANALYSE:reanalyze
 */
function parsePromoCodes(): PromoCode[] {
  const raw = (process.env.PROMO_CODES ?? "").trim();
  const fallback = "FLOPPRO:pro:50,FLOPUNLIMITED:unlimited:999,FLOPFREE:free:10,FLOPREANALYSE:reanalyze";
  const toParse = raw || fallback;

  return toParse.split(",").reduce<PromoCode[]>((acc, part) => {
    const [code, plan, limit] = part.trim().split(":");
    if (!code) return acc;
    if (plan === "reanalyze") {
      acc.push({ code: code.toUpperCase(), reanalyze: true });
      return acc;
    }
    if (plan && limit) {
      const num = parseInt(limit, 10);
      if (!["free", "pro", "unlimited"].includes(plan)) return acc;
      acc.push({ code: code.toUpperCase(), plan, analyses_limit: isNaN(num) ? 3 : num, reanalyze: false });
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
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "Non authentifié." },
        { status: 401 }
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

    if (match.reanalyze) {
      const { error } = await supabase
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
        message: "Réanalyses activées ! Elles consomment le quota comme les nouvelles analyses.",
        reanalyses_enabled: true,
      });
    }

    const { error } = await supabase
      .from("profiles")
      .update({
        plan: match.plan,
        status: "active",
        analyses_limit: match.analyses_limit,
      })
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
      message: `Plan ${match.plan} activé ! ${match.analyses_limit} analyses disponibles.`,
      plan: match.plan,
      analyses_limit: match.analyses_limit,
    });
  } catch (err) {
    console.error("Redeem code API error:", err);
    return NextResponse.json(
      { error: "Erreur." },
      { status: 500 }
    );
  }
}
