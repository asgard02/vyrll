import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/supabase/server-user";
import { isSupabaseConfigured } from "@/lib/supabase";
import { getStripe, isStripeConfigured } from "@/lib/stripe";
import {
  getUserStripeSubscription,
  toSubscriptionSummary,
} from "@/lib/stripe-subscription";

type CancelAction = "cancel" | "resume";

export async function POST(request: NextRequest) {
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

    const body = await request.json().catch(() => ({}));
    const action: CancelAction =
      body?.action === "resume" ? "resume" : "cancel";

    const { subscription, error } = await getUserStripeSubscription(user.id);
    if (!subscription) {
      return NextResponse.json(
        {
          error:
            error === "no_customer"
              ? "Aucun abonnement Stripe trouvé."
              : "Aucun abonnement actif à modifier.",
        },
        { status: 400 }
      );
    }

    if (subscription.status !== "active" && subscription.status !== "trialing") {
      return NextResponse.json(
        { error: "Cet abonnement ne peut plus être modifié." },
        { status: 400 }
      );
    }

    const stripe = getStripe();
    const wantCancel = action === "cancel";

    if (Boolean(subscription.cancel_at_period_end) === wantCancel) {
      return NextResponse.json({
        subscription: toSubscriptionSummary(subscription),
        already: true,
      });
    }

    const updated = await stripe.subscriptions.update(subscription.id, {
      cancel_at_period_end: wantCancel,
    });

    return NextResponse.json({
      subscription: toSubscriptionSummary(updated),
      already: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[stripe cancel]", message);
    if (/test mode|live mode/i.test(message) || /No such subscription/i.test(message)) {
      return NextResponse.json(
        {
          error:
            "Aucun abonnement Stripe valide sur ce mode. Resouscris via Creator ou Studio.",
        },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Impossible de modifier l'abonnement." },
      { status: 500 }
    );
  }
}
