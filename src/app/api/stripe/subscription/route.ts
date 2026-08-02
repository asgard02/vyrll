import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/supabase/server-user";
import { isSupabaseConfigured } from "@/lib/supabase";
import { isStripeConfigured } from "@/lib/stripe";
import { getUserStripeSubscription } from "@/lib/stripe-subscription";

export async function GET() {
  try {
    if (!isStripeConfigured() || !process.env.STRIPE_SECRET_KEY?.trim()) {
      return NextResponse.json(
        { error: "Stripe non configuré." },
        { status: 503 }
      );
    }
    if (!isSupabaseConfigured()) {
      return NextResponse.json(
        { error: "Supabase non configuré." },
        { status: 503 }
      );
    }

    const supabase = await createClient();
    const { user } = await getServerUser(supabase);
    if (!user) {
      return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
    }

    const { summary, error } = await getUserStripeSubscription(user.id);
    if (!summary) {
      return NextResponse.json(
        {
          subscription: null,
          error:
            error === "no_customer"
              ? "Aucun abonnement Stripe trouvé."
              : "Aucun abonnement actif.",
        },
        { status: error === "no_customer" ? 400 : 200 }
      );
    }

    return NextResponse.json({ subscription: summary });
  } catch (err) {
    console.error("[stripe subscription]", err);
    return NextResponse.json(
      { error: "Impossible de lire l'abonnement." },
      { status: 500 }
    );
  }
}
