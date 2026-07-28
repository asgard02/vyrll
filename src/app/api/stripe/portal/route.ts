import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/supabase/server-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase";
import { getSiteUrl, getStripe, isStripeConfigured } from "@/lib/stripe";

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

    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .single();

    const customerId = profile?.stripe_customer_id;
    if (!customerId || typeof customerId !== "string") {
      return NextResponse.json(
        { error: "Aucun abonnement Stripe trouvé." },
        { status: 400 }
      );
    }

    const stripe = getStripe();
    const siteUrl = getSiteUrl(request);

    try {
      const portal = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${siteUrl}/parametres?tab=plan`,
      });
      return NextResponse.json({ url: portal.url });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[stripe portal]", message);
      if (/test mode|live mode/i.test(message) || /No such customer/i.test(message)) {
        // Stale customer id from the other Stripe mode — clear it so UI recovers.
        await admin
          .from("profiles")
          .update({ stripe_customer_id: null, stripe_subscription_id: null })
          .eq("id", user.id);
        return NextResponse.json(
          {
            error:
              "Aucun abonnement Stripe valide sur ce mode. Resouscris via Creator ou Studio.",
          },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { error: "Impossible d'ouvrir le portail client." },
        { status: 500 }
      );
    }
  } catch (err) {
    console.error("[stripe portal]", err);
    return NextResponse.json(
      { error: "Impossible d'ouvrir le portail client." },
      { status: 500 }
    );
  }
}
