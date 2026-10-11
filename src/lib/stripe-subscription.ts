import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";

export type StripeSubscriptionSummary = {
  subscriptionId: string;
  status: Stripe.Subscription.Status;
  cancelAtPeriodEnd: boolean;
  /** Unix seconds — when access ends if canceled, else current period end. */
  currentPeriodEnd: number | null;
  interval: "month" | "year";
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
    interval: sub.items?.data?.[0]?.price?.recurring?.interval === "year" ? "year" : "month",
  };
}

const STRIPE_READ_TIMEOUT_MS = 10_000;

function isStripeTimeout(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const type = "type" in err ? String((err as { type?: unknown }).type) : "";
  const code = "code" in err ? String((err as { code?: unknown }).code) : "";
  return (
    type === "StripeConnectionError" ||
    code === "timeout" ||
    code === "ETIMEDOUT" ||
    code === "ECONNABORTED"
  );
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
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("stripe_customer_id, stripe_subscription_id")
    .eq("id", userId)
    .single();
  if (profileError) {
    throw new Error(profileError.message);
  }

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

  const readOptions = { timeout: STRIPE_READ_TIMEOUT_MS };

  if (subscriptionId) {
    try {
      const sub = await stripe.subscriptions.retrieve(subscriptionId, {}, readOptions);
      if (sub.status !== "canceled") {
        return {
          summary: toSubscriptionSummary(sub),
          customerId:
            customerId ||
            (typeof sub.customer === "string" ? sub.customer : null),
          subscription: sub,
        };
      }
    } catch (err) {
      if (isStripeTimeout(err)) throw err;
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

  const listed = await stripe.subscriptions.list(
    {
      customer: customerId,
      status: "all",
      limit: 10,
    },
    readOptions
  );
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
