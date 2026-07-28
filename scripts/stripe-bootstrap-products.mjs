/**
 * One-shot: create Upcut Creator + Studio products/prices in Stripe.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_... node scripts/stripe-bootstrap-products.mjs
 *
 * Prints price IDs to set as STRIPE_PRICE_CREATOR / STRIPE_PRICE_STUDIO.
 */
import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY?.trim();
if (!key) {
  console.error("Missing STRIPE_SECRET_KEY");
  process.exit(1);
}

const stripe = new Stripe(key, { apiVersion: "2026-06-24.dahlia" });

const plans = [
  {
    id: "creator",
    name: "Upcut Creator",
    description: "90 crédits/mois · clips 9:16 & sous-titres IA",
    amount: 1700,
  },
  {
    id: "studio",
    name: "Upcut Studio",
    description: "210 crédits/mois · priorité + early access",
    amount: 3900,
  },
];

for (const plan of plans) {
  const product = await stripe.products.create({
    name: plan.name,
    description: plan.description,
    metadata: { plan: plan.id },
  });
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: plan.amount,
    currency: "eur",
    recurring: { interval: "month" },
    metadata: { plan: plan.id },
  });
  console.log(`${plan.id.toUpperCase()}`);
  console.log(`  product=${product.id}`);
  console.log(`  price=${price.id}`);
  console.log(`  STRIPE_PRICE_${plan.id.toUpperCase()}=${price.id}`);
  console.log("");
}
