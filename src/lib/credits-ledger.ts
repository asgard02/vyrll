import type { SupabaseClient } from "@supabase/supabase-js";
import { quotaResetDue } from "@/lib/credit-actions";
import { creditsLimitForPlan } from "@/lib/plan";

type Admin = SupabaseClient;

export { quotaResetDue };

type ProfileQuota = {
  credits_used: number;
  credits_limit: number;
  quota_reset_at: string | null;
  billing_interval: string | null;
  plan: string | null;
};

function asQuota(row: Record<string, unknown> | null): ProfileQuota | null {
  if (!row) return null;
  const plan = typeof row.plan === "string" ? row.plan : null;
  const rawLimit = typeof row.credits_limit === "number" ? row.credits_limit : null;
  return {
    plan,
    credits_used: typeof row.credits_used === "number" ? row.credits_used : 0,
    credits_limit: rawLimit != null && rawLimit > 0 ? rawLimit : creditsLimitForPlan(plan),
    quota_reset_at: typeof row.quota_reset_at === "string" ? row.quota_reset_at : null,
    billing_interval: typeof row.billing_interval === "string" ? row.billing_interval : null,
  };
}

/**
 * Remet les crédits à zéro pour les comptes sans facture mensuelle Stripe
 * (gratuit, accords, annuel). Les abonnements mensuels restent sur invoice.paid.
 */
export async function applyMonthlyCreditReset(
  admin: Admin,
  userId: string,
  now = new Date()
): Promise<ProfileQuota | null> {
  const { data, error } = await admin
    .from("profiles")
    .select("plan, credits_used, credits_limit, quota_reset_at, billing_interval")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return null;
  const current = asQuota(data as Record<string, unknown>);
  if (!current) return null;
  if (current.billing_interval === "month") return current;
  if (!quotaResetDue(current.quota_reset_at, now)) return current;

  const quota_reset_at = now.toISOString();
  let update = admin
    .from("profiles")
    .update({ credits_used: 0, quota_reset_at })
    .eq("id", userId);
  update = current.quota_reset_at
    ? update.eq("quota_reset_at", current.quota_reset_at)
    : update.is("quota_reset_at", null);
  const { data: updated, error: updateError } = await update.select("id");
  if (updateError || !updated?.length) return current;
  return { ...current, credits_used: 0, quota_reset_at };
}

/** Réserve les crédits du job une seule fois. Le done ne doit pas redébiter. */
export async function reserveClipJob(
  admin: Admin,
  input: { jobId: string; userId: string; credits: number; limit: number }
): Promise<"reserved" | "already" | "over" | "failed"> {
  const credits = Math.max(1, Math.round(input.credits));
  const { data, error } = await admin.rpc("charge_clip_job_once", {
    p_job_id: input.jobId,
    p_user_id: input.userId,
    p_credits: credits,
  });
  if (error) {
    console.error("[credits] reserve failed:", error.message);
    return "failed";
  }
  if (data !== true) return "already";

  const { data: profile } = await admin
    .from("profiles")
    .select("credits_used")
    .eq("id", input.userId)
    .maybeSingle();
  const used = typeof profile?.credits_used === "number" ? profile.credits_used : 0;
  if (used > input.limit) {
    await refundClipJobOnce(admin, input.jobId, input.userId);
    return "over";
  }
  return "reserved";
}

/**
 * Rend la réserve une seule fois. credits_billed_at reste posé pour qu'un retry
 * du même job ne débite pas à nouveau.
 */
export async function refundClipJobOnce(
  admin: Admin,
  jobId: string,
  userId: string
): Promise<boolean> {
  const { data: job } = await admin
    .from("clip_jobs")
    .select("credits_billed_at, credits_billed_amount")
    .eq("id", jobId)
    .eq("user_id", userId)
    .maybeSingle();
  const amount =
    typeof job?.credits_billed_amount === "number" ? job.credits_billed_amount : 0;
  if (!job?.credits_billed_at || amount <= 0) return false;

  const { data: locked } = await admin
    .from("clip_jobs")
    .update({ credits_billed_amount: 0 })
    .eq("id", jobId)
    .eq("user_id", userId)
    .eq("credits_billed_amount", amount)
    .select("id");
  if (!locked?.length) return false;

  const { data: profile } = await admin
    .from("profiles")
    .select("credits_used")
    .eq("id", userId)
    .maybeSingle();
  const used = typeof profile?.credits_used === "number" ? profile.credits_used : 0;
  const next = Math.max(0, used - amount);
  const { data: written } = await admin
    .from("profiles")
    .update({ credits_used: next })
    .eq("id", userId)
    .eq("credits_used", used)
    .select("id");
  if (!written?.length) {
    await admin.from("profiles").update({ credits_used: next }).eq("id", userId);
  }
  return true;
}

/** Réserve des crédits hors job (régénération, recoupe). */
export async function reserveUserCredits(
  admin: Admin,
  userId: string,
  credits: number,
  limit: number
): Promise<boolean> {
  const amount = Math.max(1, Math.round(credits));
  const { data: profile } = await admin
    .from("profiles")
    .select("credits_used")
    .eq("id", userId)
    .maybeSingle();
  const used = typeof profile?.credits_used === "number" ? profile.credits_used : 0;
  if (used + amount > limit) return false;
  const { data: written } = await admin
    .from("profiles")
    .update({ credits_used: used + amount })
    .eq("id", userId)
    .eq("credits_used", used)
    .select("id");
  return Boolean(written?.length);
}

export async function refundUserCredits(
  admin: Admin,
  userId: string,
  credits: number
): Promise<void> {
  const amount = Math.max(0, Math.round(credits));
  if (amount <= 0) return;
  const { data: profile } = await admin
    .from("profiles")
    .select("credits_used")
    .eq("id", userId)
    .maybeSingle();
  const used = typeof profile?.credits_used === "number" ? profile.credits_used : 0;
  await admin
    .from("profiles")
    .update({ credits_used: Math.max(0, used - amount) })
    .eq("id", userId);
}
