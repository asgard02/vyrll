import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase";
import { getSiteUrl, getStripe, isStripeConfigured } from "@/lib/stripe";
import {
  subscriptionPeriodEnd,
  toSubscriptionSummary,
} from "@/lib/stripe-subscription";
import {
  formatMailDate,
  isTransactionalMailConfigured,
  sendTransactionalEmail,
} from "@/lib/transactional-mail";

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_DAYS = 30;
const MAX_DAYS = 90;

function authorizeCron(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const headerSecret = request.headers.get("x-cron-secret");
  return headerSecret === secret;
}

function planLabel(plan: string): string {
  switch (plan) {
    case "creator":
      return "Creator";
    case "studio":
      return "Studio";
    default:
      return plan;
  }
}

/**
 * Rappel de reconduction des abonnements annuels, une fois par période,
 * entre 90 et 30 jours avant current_period_end.
 * Auth : Authorization: Bearer CRON_SECRET (ou x-cron-secret).
 * À appeler une fois par jour, comme /api/cron/reset-annual-quota.
 */
export async function GET(request: NextRequest) {
  try {
    if (!authorizeCron(request)) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    if (!isSupabaseConfigured() || !isStripeConfigured()) {
      return NextResponse.json({ error: "Service non configuré." }, { status: 503 });
    }
    if (!isTransactionalMailConfigured()) {
      return NextResponse.json({ error: "E-mail non configuré." }, { status: 503 });
    }

    const admin = createAdminClient();
    const stripe = getStripe();
    const siteUrl = getSiteUrl(request);
    const { data: annual, error: listError } = await admin
      .from("profiles")
      .select("id, email, plan, stripe_subscription_id")
      .eq("billing_interval", "year")
      .in("plan", ["creator", "studio"])
      .not("stripe_subscription_id", "is", null);

    if (listError) throw listError;

    let sent = 0;
    let skipped = 0;
    const now = Date.now();

    for (const row of annual ?? []) {
      const subscriptionId =
        typeof row.stripe_subscription_id === "string"
          ? row.stripe_subscription_id
          : null;
      let email = typeof row.email === "string" ? row.email.trim() : "";
      if (!email && typeof row.id === "string") {
        const { data: authUser } = await admin.auth.admin.getUserById(row.id);
        email = authUser.user?.email?.trim() ?? "";
      }
      if (!subscriptionId || !email) {
        skipped += 1;
        continue;
      }

      try {
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        const summary = toSubscriptionSummary(sub);
        if (summary.interval !== "year") {
          skipped += 1;
          continue;
        }
        if (summary.status !== "active" && summary.status !== "trialing") {
          skipped += 1;
          continue;
        }
        if (summary.cancelAtPeriodEnd) {
          skipped += 1;
          continue;
        }
        const periodEnd = subscriptionPeriodEnd(sub);
        if (periodEnd == null) {
          skipped += 1;
          continue;
        }
        const days = (periodEnd * 1000 - now) / DAY_MS;
        if (days < MIN_DAYS || days > MAX_DAYS) {
          skipped += 1;
          continue;
        }

        const periodEndIso = new Date(periodEnd * 1000).toISOString();
        const { data: existing, error: existingError } = await admin
          .from("renewal_reminders")
          .select("id")
          .eq("stripe_subscription_id", subscriptionId)
          .eq("period_end", periodEndIso)
          .maybeSingle();
        if (existingError) throw existingError;
        if (existing) {
          skipped += 1;
          continue;
        }

        const date = formatMailDate(periodEnd);
        const mailed = await sendTransactionalEmail({
          to: email,
          subject: `Ton abonnement TrimoAI sera reconduit le ${date}`,
          text:
            `Ton abonnement ${planLabel(String(row.plan))} sera reconduit automatiquement le ${date}.\n` +
            `Tu peux résilier à tout moment depuis ton espace : ${siteUrl}/parametres\n`,
        });
        if (!mailed.ok) {
          console.error("[cron/annual-renewal-reminder] email", mailed.error);
          skipped += 1;
          continue;
        }

        const { error: insertError } = await admin.from("renewal_reminders").insert({
          user_id: row.id,
          stripe_subscription_id: subscriptionId,
          period_end: periodEndIso,
        });
        if (insertError) {
          console.error("[cron/annual-renewal-reminder] insert", insertError);
          continue;
        }
        sent += 1;
      } catch (err) {
        console.error("[cron/annual-renewal-reminder] subscription", subscriptionId, err);
        skipped += 1;
      }
    }

    console.log(`[cron/annual-renewal-reminder] sent=${sent} skipped=${skipped}`);
    return NextResponse.json({ ok: true, sent, skipped });
  } catch (err) {
    console.error("[cron/annual-renewal-reminder]", err);
    return NextResponse.json({ error: "Erreur." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
