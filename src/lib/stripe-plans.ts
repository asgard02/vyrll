import { PLAN_CREDITS } from "@/lib/plan";

export type PaidPlanId = "creator" | "studio";

export const STRIPE_PLAN_LIMITS: Record<
  PaidPlanId,
  { credits_limit: number; analyses_limit: number }
> = {
  creator: { credits_limit: PLAN_CREDITS.creatorMonthly, analyses_limit: 20 },
  studio: { credits_limit: PLAN_CREDITS.studioMonthly, analyses_limit: -1 },
};

/** Affichage + intention de facturation. Les Price IDs Stripe doivent matcher ces montants. */
export const STRIPE_PLAN_PRICES_EUR: Record<PaidPlanId, number> = {
  creator: 19,
  studio: 45,
};

/** Anciens prix 17 € / 39 € — les abos existants gardent ces Price IDs. */
const LEGACY_STRIPE_PRICE_IDS: Record<string, PaidPlanId> = {
  price_1TyEayAfCnZ9DRKUWUZENpIf: "creator",
  price_1TyEazAfCnZ9DRKUjCWNUgsa: "studio",
  price_1TyEikAfCnZ9DRKU0eFIwNNf: "creator",
  price_1TyEilAfCnZ9DRKU13dyFH3g: "studio",
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
  return LEGACY_STRIPE_PRICE_IDS[priceId] ?? null;
}

export function isPaidPlanId(value: string): value is PaidPlanId {
  return value === "creator" || value === "studio";
}
