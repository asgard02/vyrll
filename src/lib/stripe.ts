import Stripe from "stripe";

let stripeClient: Stripe | null = null;

/** Server-only Stripe client. Never import from client components. */
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  if (!stripeClient) {
    stripeClient = new Stripe(key, {
      apiVersion: "2026-06-24.dahlia",
      typescript: true,
    });
  }
  return stripeClient;
}

export function isStripeConfigured(): boolean {
  return Boolean(
    process.env.STRIPE_SECRET_KEY?.trim() &&
      process.env.STRIPE_PRICE_CREATOR?.trim() &&
      process.env.STRIPE_PRICE_STUDIO?.trim()
  );
}

export function getSiteUrl(request?: { headers: Headers; nextUrl?: URL }): string {
  // Local/dev: always return to the running app, not a stale prod URL in .env.
  if (process.env.NODE_ENV === "development") {
    const origin = request?.headers.get("origin")?.trim();
    if (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
      return origin.replace(/\/$/, "");
    }
    return "http://localhost:3000";
  }

  const origin = request?.headers.get("origin")?.trim();
  if (origin && /^https?:\/\//i.test(origin)) {
    return origin.replace(/\/$/, "");
  }

  const url =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.VERCEL_URL?.trim();
  if (!url) return "http://localhost:3000";
  return url.startsWith("http") ? url.replace(/\/$/, "") : `https://${url}`;
}
