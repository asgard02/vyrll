import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/supabase/server-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase";
import { getSiteUrl, getStripe, isStripeConfigured } from "@/lib/stripe";
import { isPaidPlanId, priceIdForPlan } from "@/lib/stripe-plans";

function randomSuffix(length = 8): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export async function POST(request: NextRequest) {
  try {
    if (!isStripeConfigured()) {
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
    if (!user.email_confirmed_at) {
      return NextResponse.json(
        { error: "Adresse email non vérifiée." },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const plan = typeof body?.plan === "string" ? body.plan.trim() : "";
    if (!isPaidPlanId(plan)) {
      return NextResponse.json({ error: "Plan invalide." }, { status: 400 });
    }

    const priceId = priceIdForPlan(plan);
    if (!priceId) {
      return NextResponse.json(
        { error: "Prix Stripe manquant pour ce plan." },
        { status: 503 }
      );
    }

    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("id, email, plan, stripe_customer_id")
      .eq("id", user.id)
      .single();

    if (profile?.plan === plan) {
      return NextResponse.json(
        { error: "Tu es déjà sur ce plan." },
        { status: 400 }
      );
    }

    const stripe = getStripe();
    const siteUrl = getSiteUrl(request);

    let customerId =
      typeof profile?.stripe_customer_id === "string"
        ? profile.stripe_customer_id
        : null;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? profile?.email ?? undefined,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
      await admin
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", user.id);
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${siteUrl}/parametres?tab=plan&checkout=success`,
      cancel_url: `${siteUrl}/checkout/${plan}?checkout=cancel`,
      client_reference_id: user.id,
      allow_promotion_codes: true,
      metadata: {
        supabase_user_id: user.id,
        plan,
      },
      subscription_data: {
        metadata: {
          supabase_user_id: user.id,
          plan,
        },
      },
      integration_identifier: `upcut-checkout-${randomSuffix()}`,
    });

    if (!session.url) {
      return NextResponse.json(
        { error: "Impossible de créer la session Checkout." },
        { status: 500 }
      );
    }

    return NextResponse.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error("[stripe checkout]", err);
    return NextResponse.json(
      { error: "Erreur lors de la création du paiement." },
      { status: 500 }
    );
  }
}
