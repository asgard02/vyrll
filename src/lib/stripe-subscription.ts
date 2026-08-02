import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";

export type StripeSubscriptionSummary = {
  subscriptionId: string;
  status: Stripe.Subscription.Status;
  cancelAtPeriodEnd: boolean;
  /** Unix seconds — when access ends if canceled, else current period end. */
  currentPeriodEnd: number | null;
};

export function subscriptionPeriodEnd(
  sub: Stripe.Subscription
): number | null {
  if (typeof sub.cancel_at === "number") return sub.cancel_at;
  const itemEnd = sub.items?.data?.[0]?.current_period_end;
  if (typeof itemEnd === "number") return itemEnd;
  const legacy = (sub as { current_period_end?: number }).current_period_end;
  return typeof legacy === "number" ? legacy : null;
}

export function toSubscriptionSummary(
  sub: Stripe.Subscription
): StripeSubscriptionSummary {
  return {
    subscriptionId: sub.id,
    status: sub.status,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    currentPeriodEnd: subscriptionPeriodEnd(sub),
  };
}

/** Resolve the user's Stripe subscription from profile ids, with customer fallback. */
export async function getUserStripeSubscription(
  userId: string
): Promise<{
  summary: StripeSubscriptionSummary | null;
  customerId: string | null;
  subscription: Stripe.Subscription | null;
  error?: "no_customer" | "not_found";
}> {
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("stripe_customer_id, stripe_subscription_id")
    .eq("id", userId)
    .single();

  const customerId =
    typeof profile?.stripe_customer_id === "string"
      ? profile.stripe_customer_id
      : null;
  const subscriptionId =
    typeof profile?.stripe_subscription_id === "string"
      ? profile.stripe_subscription_id
      : null;

  if (!customerId && !subscriptionId) {
    return {
      summary: null,
      customerId: null,
      subscription: null,
      error: "no_customer",
    };
  }

  const stripe = getStripe();

  if (subscriptionId) {
    try {
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      if (sub.status !== "canceled") {
        return {
          summary: toSubscriptionSummary(sub),
          customerId:
            customerId ||
            (typeof sub.customer === "string" ? sub.customer : null),
          subscription: sub,
        };
      }
    } catch {
      // Fall through to list by customer.
    }
  }

  if (!customerId) {
    return {
      summary: null,
      customerId: null,
      subscription: null,
      error: "not_found",
    };
  }

  const listed = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 10,
  });
  const active = listed.data.find(
    (s) => s.status === "active" || s.status === "trialing" || s.status === "past_due"
  );
  if (!active) {
    return {
      summary: null,
      customerId,
      subscription: null,
      error: "not_found",
    };
  }

  // Heal stale subscription id on profile.
  if (active.id !== subscriptionId) {
    await admin
      .from("profiles")
      .update({ stripe_subscription_id: active.id })
      .eq("id", userId);
  }

  return {
    summary: toSubscriptionSummary(active),
    customerId,
    subscription: active,
  };
}
