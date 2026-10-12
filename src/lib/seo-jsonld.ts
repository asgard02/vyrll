import {
  STRIPE_ENTERPRISE_PRICE_EUR,
  STRIPE_PLAN_ANNUAL_PRICES_EUR,
  STRIPE_PLAN_PRICES_EUR,
} from "@/lib/stripe-plans";
import { SITE_URL } from "@/lib/seo-metadata";

type FaqItem = { q: string; a: string };

export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "TrimoAI",
    url: SITE_URL,
    logo: `${SITE_URL}/apple-touch-icon-ta.png`,
  };
}

export function softwareApplicationJsonLd(description: string) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "TrimoAI",
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Web",
    url: SITE_URL,
    description,
    offers: [
      {
        "@type": "Offer",
        name: "Free",
        price: "0",
        priceCurrency: "EUR",
      },
      {
        "@type": "Offer",
        name: "Creator",
        price: String(STRIPE_PLAN_PRICES_EUR.creator),
        priceCurrency: "EUR",
      },
      {
        "@type": "Offer",
        name: "Creator yearly",
        price: String(STRIPE_PLAN_ANNUAL_PRICES_EUR.creator),
        priceCurrency: "EUR",
      },
      {
        "@type": "Offer",
        name: "Studio",
        price: String(STRIPE_PLAN_PRICES_EUR.studio),
        priceCurrency: "EUR",
      },
      {
        "@type": "Offer",
        name: "Studio yearly",
        price: String(STRIPE_PLAN_ANNUAL_PRICES_EUR.studio),
        priceCurrency: "EUR",
      },
      {
        "@type": "Offer",
        name: "Enterprise",
        price: String(STRIPE_ENTERPRISE_PRICE_EUR),
        priceCurrency: "EUR",
      },
    ],
  };
}

function monthlyOffer(name: string, price: number) {
  const amount = String(price);
  return {
    "@type": "Offer",
    name,
    price: amount,
    priceCurrency: "EUR",
    priceSpecification: {
      "@type": "UnitPriceSpecification",
      price: amount,
      priceCurrency: "EUR",
      unitCode: "MON",
    },
  };
}

/** Offres affichées sur /plans : Free, Creator, Studio, prix mensuels de la config Stripe. */
export function plansSoftwareApplicationJsonLd(description: string) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "TrimoAI",
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Web",
    url: `${SITE_URL}/plans`,
    description,
    offers: [
      {
        "@type": "Offer",
        name: "Free",
        price: "0",
        priceCurrency: "EUR",
      },
      monthlyOffer("Creator", STRIPE_PLAN_PRICES_EUR.creator),
      monthlyOffer("Studio", STRIPE_PLAN_PRICES_EUR.studio),
    ],
  };
}

export function articleJsonLd(input: {
  headline: string;
  description: string;
  path: string;
  datePublished: string;
  dateModified: string;
  inLanguage: "fr-FR" | "en-US";
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: input.headline,
    description: input.description,
    datePublished: input.datePublished,
    dateModified: input.dateModified,
    inLanguage: input.inLanguage,
    mainEntityOfPage: `${SITE_URL}${input.path}`,
    author: {
      "@type": "Organization",
      name: "TrimoAI",
      url: SITE_URL,
    },
    publisher: {
      "@type": "Organization",
      name: "TrimoAI",
      url: SITE_URL,
      logo: {
        "@type": "ImageObject",
        url: `${SITE_URL}/apple-touch-icon-ta.png`,
      },
    },
  };
}

export function faqPageJsonLd(items: FaqItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.a,
      },
    })),
  };
}
