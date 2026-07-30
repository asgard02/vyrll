import type { PaidPlanId } from "@/lib/stripe-plans";
import { STRIPE_PLAN_LIMITS, STRIPE_PLAN_PRICES_EUR } from "@/lib/stripe-plans";

const PLAN_LABEL: Record<PaidPlanId, string> = {
  creator: "Creator",
  studio: "Studio",
};

const PLAN_BLURB: Record<PaidPlanId, string> = {
  creator: "1h30 de quota / mois · jusqu’à 10 clips par vidéo · éditeur de sous-titres",
  studio:
    "3h30 de quota / mois · jusqu’à 10 clips par vidéo · early access aux nouvelles features",
};

export type SubscriptionThanksInput = {
  plan: PaidPlanId;
  username?: string | null;
  siteUrl?: string;
};

function siteOrigin(siteUrl?: string): string {
  const raw =
    siteUrl?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    "https://upcut.app";
  return raw.replace(/\/$/, "");
}

export function subscriptionThanksSubject(plan: PaidPlanId): string {
  return `Merci pour ton abonnement Upcut ${PLAN_LABEL[plan]} 🎬`;
}

export function buildSubscriptionThanksText(input: SubscriptionThanksInput): string {
  const origin = siteOrigin(input.siteUrl);
  const label = PLAN_LABEL[input.plan];
  const hello = input.username?.trim()
    ? `Salut ${input.username.trim()},`
    : "Salut,";
  const limits = STRIPE_PLAN_LIMITS[input.plan];
  const price = STRIPE_PLAN_PRICES_EUR[input.plan];

  return [
    hello,
    "",
    `Merci d’avoir rejoint Upcut en ${label} (${price}€/mois).`,
    "Ton abonnement est actif — tu peux générer des clips dès maintenant.",
    "",
    `Ce qui est inclus : ${PLAN_BLURB[input.plan]}`,
    `Crédits ce mois-ci : ${limits.credits_limit} (1 crédit = 1 min de vidéo source).`,
    "",
    `Ouvre ton dashboard : ${origin}/dashboard`,
    `Gérer l’abonnement : ${origin}/parametres`,
    "",
    "Si tu as la moindre question, réponds simplement à cet email.",
    "",
    "— L’équipe Upcut",
    origin,
  ].join("\n");
}

export function buildSubscriptionThanksHtml(input: SubscriptionThanksInput): string {
  const origin = siteOrigin(input.siteUrl);
  const label = PLAN_LABEL[input.plan];
  const hello = input.username?.trim()
    ? `Salut ${escapeHtml(input.username.trim())},`
    : "Salut,";
  const limits = STRIPE_PLAN_LIMITS[input.plan];
  const price = STRIPE_PLAN_PRICES_EUR[input.plan];
  const logoUrl = `${origin}/logo-full.svg`;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(subscriptionThanksSubject(input.plan))}</title>
</head>
<body style="margin:0;padding:0;background:#0b0c10;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#e8e9ed;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0c10;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:linear-gradient(180deg,#14161d 0%,#101218 100%);border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden;">
          <tr>
            <td style="padding:28px 28px 8px 28px;">
              <img src="${escapeHtml(logoUrl)}" alt="Upcut" width="120" height="32" style="display:block;height:32px;width:auto;" />
            </td>
          </tr>
          <tr>
            <td style="padding:12px 28px 0 28px;">
              <p style="margin:0;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;color:#2dd4bf;font-weight:700;">Abonnement confirmé</p>
              <h1 style="margin:10px 0 0 0;font-size:26px;line-height:1.2;font-weight:800;color:#ffffff;">Merci pour ton abonnement&nbsp;!</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px 0 28px;font-size:16px;line-height:1.6;color:#c4c7d0;">
              <p style="margin:0 0 14px 0;">${hello}</p>
              <p style="margin:0 0 14px 0;">
                Tu es officiellement sur le plan <strong style="color:#fff;">${escapeHtml(label)}</strong>
                (${price}&nbsp;€/mois). Merci de soutenir Upcut — ton accès est déjà actif.
              </p>
              <p style="margin:0;">
                Colle une URL YouTube ou Twitch, et récupère tes clips 9:16 avec sous-titres IA.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 28px 0 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:rgba(45,212,191,0.08);border:1px solid rgba(45,212,191,0.25);border-radius:12px;">
                <tr>
                  <td style="padding:16px 18px;">
                    <p style="margin:0 0 6px 0;font-size:12px;letter-spacing:0.1em;text-transform:uppercase;color:#5eead4;font-weight:700;">Plan ${escapeHtml(label)}</p>
                    <p style="margin:0;font-size:15px;line-height:1.5;color:#e8e9ed;">${escapeHtml(PLAN_BLURB[input.plan])}</p>
                    <p style="margin:10px 0 0 0;font-size:14px;color:#aeb2bd;">
                      ${limits.credits_limit} crédits ce mois-ci · 1 crédit = 1&nbsp;min de vidéo source
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:26px 28px 8px 28px;" align="center">
              <a href="${escapeHtml(origin)}/dashboard" style="display:inline-block;background:#2dd4bf;color:#042f2e;text-decoration:none;font-weight:700;font-size:15px;padding:12px 22px;border-radius:999px;">
                Ouvrir mon dashboard
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 28px 28px;font-size:14px;line-height:1.6;color:#9aa0ad;" align="center">
              <p style="margin:0 0 10px 0;">
                Tu peux gérer ou résilier ton abonnement à tout moment dans
                <a href="${escapeHtml(origin)}/parametres" style="color:#5eead4;text-decoration:underline;">Paramètres</a>.
              </p>
              <p style="margin:0;">Une question&nbsp;? Réponds simplement à cet email — on lit tout.</p>
            </td>
          </tr>
        </table>
        <p style="margin:18px 0 0 0;font-size:12px;color:#6b7280;">
          Upcut · <a href="${escapeHtml(origin)}" style="color:#6b7280;text-decoration:underline;">upcut.app</a>
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
