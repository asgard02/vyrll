import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/supabase/server-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase";
import { getStripe, isStripeConfigured } from "@/lib/stripe";
import { getUserStripeSubscription } from "@/lib/stripe-subscription";

export async function DELETE() {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: "Non configuré." }, { status: 503 });
    }

    const supabase = await createClient();
    const { user } = await getServerUser(supabase);
    if (!user) {
      return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
    }

    // Stop Stripe billing before wiping the auth user.
    if (isStripeConfigured() && process.env.STRIPE_SECRET_KEY?.trim()) {
      try {
        const { subscription } = await getUserStripeSubscription(user.id);
        if (
          subscription &&
          (subscription.status === "active" ||
            subscription.status === "trialing" ||
            subscription.status === "past_due")
        ) {
          const stripe = getStripe();
          await stripe.subscriptions.cancel(subscription.id);
        }
      } catch (err) {
        console.error("[account delete] stripe cancel:", err);
        // Continue — account deletion must not be blocked by Stripe glitches.
      }
    }

    const admin = createAdminClient();
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) {
      console.error("[account delete]", error);
      return NextResponse.json(
        { error: "Impossible de supprimer le compte." },
        { status: 500 }
      );
    }

    await supabase.auth.signOut();
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[account delete]", err);
    return NextResponse.json(
      { error: "Impossible de supprimer le compte." },
      { status: 500 }
    );
  }
}
