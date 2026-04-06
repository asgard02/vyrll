import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase";

export async function PATCH(request: NextRequest) {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: "Non configuré." }, { status: 503 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
    }

    if (!user.email_confirmed_at) {
      return NextResponse.json(
        { error: "Adresse email non vérifiée." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const username = typeof body?.username === "string" ? body.username.trim() : null;

    if (!username || username.length < 2) {
      return NextResponse.json(
        { error: "Le pseudo doit faire au moins 2 caractères." },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from("profiles")
      .update({ username })
      .eq("id", user.id);

    if (error) {
      console.error("Profile update error:", error);
      return NextResponse.json(
        { error: "Erreur lors de la mise à jour." },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, username });
  } catch {
    return NextResponse.json({ error: "Erreur." }, { status: 500 });
  }
}

export async function GET() {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json(null);
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(null);
    }

    const creditsLimitByPlan: Record<string, number> = {
      free: 30,
      creator: 150,
      studio: 400,
    };

    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, username, plan, analyses_used, analyses_limit, credits_used, credits_limit")
      .eq("id", user.id)
      .single();

    if (error || !data) {
      const fallback = await supabase
        .from("profiles")
        .select("id, email, username, plan, analyses_used, analyses_limit")
        .eq("id", user.id)
        .single();
      if (fallback.error || !fallback.data) return NextResponse.json(null);
      const d = fallback.data;
      return NextResponse.json({
        ...d,
        credits_used: 0,
        credits_limit: creditsLimitByPlan[d.plan ?? "free"] ?? 30,
      });
    }

    const credits_limit =
      data.credits_limit != null && data.credits_limit > 0
        ? data.credits_limit
        : creditsLimitByPlan[data.plan ?? "free"] ?? 30;

    return NextResponse.json({
      ...data,
      credits_used: data.credits_used ?? 0,
      credits_limit,
    });
  } catch {
    return NextResponse.json(null);
  }
}
