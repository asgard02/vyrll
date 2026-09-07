import { PLAN_CREDITS } from "@/lib/plan";

export type PaidPlanId = "creator" | "studio";
export type BillingInterval = "month" | "year";
export type PlansOfferView = BillingInterval | "enterprise";

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

/** Annuel : Creator 15 €/mois (180 €) · Studio 37,50 €/mois (450 €). */
export const STRIPE_PLAN_ANNUAL_PRICES_EUR: Record<PaidPlanId, number> = {
  creator: 180,
  studio: 450,
};

export const ANNUAL_DISCOUNT_PERCENT = Math.round(
  (1 -
    STRIPE_PLAN_ANNUAL_PRICES_EUR.creator /
      (STRIPE_PLAN_PRICES_EUR.creator * 12)) *
    100
);

export const STRIPE_ENTERPRISE_PRICE_EUR = 300;
export const ENTERPRISE_CLIPS_PER_MONTH = 500;
export const ENTERPRISE_CONTACT_EMAIL = "noreply@upcut.app";

/** Anciens prix 17 € / 39 € — les abos existants gardent ces Price IDs. */
const KNOWN_STRIPE_PRICE_IDS: Record<string, PaidPlanId> = {
  price_1TyEayAfCnZ9DRKUWUZENpIf: "creator",
  price_1TyEazAfCnZ9DRKUjCWNUgsa: "studio",
  price_1TyEikAfCnZ9DRKU0eFIwNNf: "creator",
  price_1TyEilAfCnZ9DRKU13dyFH3g: "studio",
  price_1UCzQMAfCnZ9DRKU0I7SBuoY: "creator",
  price_1UD04TAfCnZ9DRKUaLWPnJFB: "creator",
  price_1UCzQMAfCnZ9DRKUJQ3HgUY0: "studio",
};

const PRICE_ENV: Record<PaidPlanId, Record<BillingInterval, string>> = {
  creator: {
    month: "STRIPE_PRICE_CREATOR",
    year: "STRIPE_PRICE_CREATOR_YEARLY",
  },
  studio: {
    month: "STRIPE_PRICE_STUDIO",
    year: "STRIPE_PRICE_STUDIO_YEARLY",
  },
};

export function isBillingInterval(value: unknown): value is BillingInterval {
  return value === "month" || value === "year";
}

export function parseBillingInterval(value: unknown): BillingInterval {
  return value === "year" ? "year" : "month";
}

export function chargedPriceEur(
  plan: PaidPlanId,
  interval: BillingInterval
): number {
  return interval === "year"
    ? STRIPE_PLAN_ANNUAL_PRICES_EUR[plan]
    : STRIPE_PLAN_PRICES_EUR[plan];
}

/** Équivalent mensuel affiché (annuel ÷ 12). */
export function monthlyEquivalentEur(
  plan: PaidPlanId,
  interval: BillingInterval
): number {
  if (interval === "month") return STRIPE_PLAN_PRICES_EUR[plan];
  return Math.round((STRIPE_PLAN_ANNUAL_PRICES_EUR[plan] / 12) * 100) / 100;
}

export function formatPlanPriceEur(amount: number, locale?: string): string {
  const loc = locale === "en" ? "en-US" : "fr-FR";
  return amount.toLocaleString(loc, {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export function priceIdForPlan(
  plan: PaidPlanId,
  interval: BillingInterval = "month"
): string | null {
  const id = process.env[PRICE_ENV[plan][interval]]?.trim();
  return id || null;
}

export function planFromPriceId(priceId: string | null | undefined): PaidPlanId | null {
  if (!priceId) return null;
  for (const plan of ["creator", "studio"] as const) {
    for (const interval of ["month", "year"] as const) {
      const envId = process.env[PRICE_ENV[plan][interval]]?.trim();
      if (envId && priceId === envId) return plan;
    }
  }
  return KNOWN_STRIPE_PRICE_IDS[priceId] ?? null;
}

export function isPaidPlanId(value: string): value is PaidPlanId {
  return value === "creator" || value === "studio";
}
