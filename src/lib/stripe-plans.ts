export type PaidPlanId = "creator" | "studio";

export const STRIPE_PLAN_LIMITS: Record<
  PaidPlanId,
  { credits_limit: number; analyses_limit: number }
> = {
  creator: { credits_limit: 90, analyses_limit: 20 },
  studio: { credits_limit: 210, analyses_limit: -1 },
};

export const STRIPE_PLAN_PRICES_EUR: Record<PaidPlanId, number> = {
  creator: 17,
  studio: 39,
};

export function priceIdForPlan(plan: PaidPlanId): string | null {
  const envKey =
    plan === "creator" ? "STRIPE_PRICE_CREATOR" : "STRIPE_PRICE_STUDIO";
  const id = process.env[envKey]?.trim();
  return id || null;
}

export function planFromPriceId(priceId: string | null | undefined): PaidPlanId | null {
  if (!priceId) return null;
  const creator = process.env.STRIPE_PRICE_CREATOR?.trim();
  const studio = process.env.STRIPE_PRICE_STUDIO?.trim();
  if (creator && priceId === creator) return "creator";
  if (studio && priceId === studio) return "studio";
  return null;
}

export function isPaidPlanId(value: string): value is PaidPlanId {
  return value === "creator" || value === "studio";
}
