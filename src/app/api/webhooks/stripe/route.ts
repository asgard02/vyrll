import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase";
import { getStripe } from "@/lib/stripe";
import {
  planFromPriceId,
  STRIPE_PLAN_LIMITS,
  type PaidPlanId,
} from "@/lib/stripe-plans";

async function activatePlan(
  userId: string,
  plan: PaidPlanId,
  extras: {
    stripe_customer_id?: string | null;
    stripe_subscription_id?: string | null;
    /** Fresh paid period: full 90/210 (don't keep free-tier usage). */
    resetUsage?: boolean;
  } = {}
) {
  const limits = STRIPE_PLAN_LIMITS[plan];
  const admin = createAdminClient();
  const patch: Record<string, unknown> = {
    plan,
    status: "active",
    credits_limit: limits.credits_limit,
    analyses_limit: limits.analyses_limit,
  };
  if (extras.resetUsage) {
    patch.credits_used = 0;
    patch.analyses_used = 0;
  }
  if (extras.stripe_customer_id) {
    patch.stripe_customer_id = extras.stripe_customer_id;
  }
  if (extras.stripe_subscription_id) {
    patch.stripe_subscription_id = extras.stripe_subscription_id;
  }
  const { error } = await admin.from("profiles").update(patch).eq("id", userId);
  if (error) throw error;
}

async function resetPeriodUsage(userId: string) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ credits_used: 0, analyses_used: 0 })
    .eq("id", userId);
  if (error) throw error;
}

async function downgradeToFree(userId: string) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({
      plan: "free",
      status: "active",
      credits_limit: 30,
      analyses_limit: 5,
      credits_used: 0,
      analyses_used: 0,
      stripe_subscription_id: null,
    })
    .eq("id", userId);
  if (error) throw error;
}

function userIdFromSubscription(sub: Stripe.Subscription): string | null {
  const meta = sub.metadata?.supabase_user_id;
  if (typeof meta === "string" && meta.trim()) return meta.trim();
  return null;
}

function planFromSubscription(sub: Stripe.Subscription): PaidPlanId | null {
  const metaPlan = sub.metadata?.plan;
  if (metaPlan === "creator" || metaPlan === "studio") return metaPlan;
  const priceId = sub.items.data[0]?.price?.id;
  return planFromPriceId(priceId);
}

async function resolveUserIdByCustomer(
  customerId: string
): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return data?.id ?? null;
}

async function resolveUserIdFromInvoice(
  invoice: Stripe.Invoice
): Promise<string | null> {
  const customerId =
    typeof invoice.customer === "string"
      ? invoice.customer
      : invoice.customer?.id;
  if (customerId) {
    const byCustomer = await resolveUserIdByCustomer(customerId);
    if (byCustomer) return byCustomer;
  }

  const subRef = invoice.parent?.subscription_details?.subscription;
  const subscriptionId =
    typeof subRef === "string" ? subRef : subRef && typeof subRef === "object" && "id" in subRef
      ? (subRef as { id: string }).id
      : null;

  if (subscriptionId) {
    const stripe = getStripe();
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    return userIdFromSubscription(sub);
  }
  return null;
}

export async function POST(request: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    return NextResponse.json(
      { error: "Webhook Stripe non configuré." },
      { status: 503 }
    );
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase non configuré." },
      { status: 503 }
    );
  }

  const stripe = getStripe();
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Signature manquante." }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error("[stripe webhook] signature:", err);
    return NextResponse.json({ error: "Signature invalide." }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription") break;

        const userId =
          (typeof session.client_reference_id === "string" &&
            session.client_reference_id) ||
          (typeof session.metadata?.supabase_user_id === "string" &&
            session.metadata.supabase_user_id) ||
          null;
        if (!userId) {
          console.warn("[stripe webhook] checkout missing user id");
          break;
        }

        let plan: PaidPlanId | null =
          session.metadata?.plan === "creator" ||
          session.metadata?.plan === "studio"
            ? session.metadata.plan
            : null;

        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id;
        const customerId =
          typeof session.customer === "string"
            ? session.customer
            : session.customer?.id;

        if (!plan && subscriptionId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          plan = planFromSubscription(sub);
        }

        if (!plan) {
          console.warn("[stripe webhook] checkout unknown plan");
          break;
        }

        await activatePlan(userId, plan, {
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          resetUsage: true,
        });
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const status = sub.status;
        let userId = userIdFromSubscription(sub);
        if (!userId) {
          const customerId =
            typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
          if (customerId) userId = await resolveUserIdByCustomer(customerId);
        }
        if (!userId) {
          console.warn("[stripe webhook] subscription.updated missing user");
          break;
        }

        if (status === "active" || status === "trialing") {
          const plan = planFromSubscription(sub);
          if (!plan) break;

          const admin = createAdminClient();
          const { data: current } = await admin
            .from("profiles")
            .select("plan")
            .eq("id", userId)
            .maybeSingle();
          const planChanged = current?.plan !== plan;

          await activatePlan(userId, plan, {
            stripe_subscription_id: sub.id,
            stripe_customer_id:
              typeof sub.customer === "string" ? sub.customer : undefined,
            resetUsage: planChanged,
          });
        } else if (
          status === "canceled" ||
          status === "unpaid" ||
          status === "incomplete_expired"
        ) {
          await downgradeToFree(userId);
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        let userId = userIdFromSubscription(sub);
        if (!userId) {
          const customerId =
            typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
          if (customerId) userId = await resolveUserIdByCustomer(customerId);
        }
        if (!userId) {
          console.warn("[stripe webhook] subscription.deleted missing user");
          break;
        }
        await downgradeToFree(userId);
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        // New monthly period — refresh quota. Skip first invoice (handled by checkout).
        if (invoice.billing_reason !== "subscription_cycle") break;
        const userId = await resolveUserIdFromInvoice(invoice);
        if (!userId) {
          console.warn("[stripe webhook] invoice.paid missing user");
          break;
        }
        await resetPeriodUsage(userId);
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error("[stripe webhook] handler:", err);
    return NextResponse.json({ error: "Traitement échoué." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
