import { STRIPE_PLAN_PRICES_EUR } from "@/lib/stripe-plans";
import { SITE_URL } from "@/lib/seo-metadata";

type FaqItem = { q: string; a: string };

export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Upcut",
    url: SITE_URL,
    logo: `${SITE_URL}/logo.svg`,
  };
}

export function softwareApplicationJsonLd(description: string) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Upcut",
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
        name: "Studio",
        price: String(STRIPE_PLAN_PRICES_EUR.studio),
        priceCurrency: "EUR",
      },
    ],
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
