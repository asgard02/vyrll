/**
 * One-shot: send the subscription thank-you preview to mae.prina@gmail.com
 *
 * Usage:
 *   RESEND_API_KEY=re_xxx node --import tsx scripts/send-thanks-preview.mjs
 *   # or after build with env loaded:
 *   node scripts/send-thanks-preview.mjs
 */
import { Resend } from "resend";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadEnvLocal();

const PREVIEW_TO = "mae.prina@gmail.com";
const PLAN = process.env.PREVIEW_PLAN === "studio" ? "studio" : "creator";
const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://upcut.app").replace(
  /\/$/,
  ""
);

const PLAN_LABEL = { creator: "Creator", studio: "Studio" };
const PLAN_BLURB = {
  creator:
    "1h30 de quota / mois · jusqu’à 10 clips par vidéo · éditeur de sous-titres",
  studio:
    "3h30 de quota / mois · jusqu’à 10 clips par vidéo · early access aux nouvelles features",
};
const CREDITS = { creator: 90, studio: 210 };
const PRICE = { creator: 17, studio: 39 };

const subject = `Merci pour ton abonnement Upcut ${PLAN_LABEL[PLAN]} 🎬`;
const logoUrl = `${SITE}/logo-full.svg`;

const text = [
  "Salut Maé,",
  "",
  `Merci d’avoir rejoint Upcut en ${PLAN_LABEL[PLAN]} (${PRICE[PLAN]}€/mois).`,
  "Ton abonnement est actif — tu peux générer des clips dès maintenant.",
  "",
  `Ce qui est inclus : ${PLAN_BLURB[PLAN]}`,
  `Crédits ce mois-ci : ${CREDITS[PLAN]} (1 crédit = 1 min de vidéo source).`,
  "",
  `Ouvre ton dashboard : ${SITE}/dashboard`,
  `Gérer l’abonnement : ${SITE}/parametres`,
  "",
  "Si tu as la moindre question, réponds simplement à cet email.",
  "",
  "— L’équipe Upcut",
  SITE,
].join("\n");

const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#0b0c10;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#e8e9ed;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0c10;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:linear-gradient(180deg,#14161d 0%,#101218 100%);border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden;">
          <tr>
            <td style="padding:28px 28px 8px 28px;">
              <img src="${logoUrl}" alt="Upcut" width="120" height="32" style="display:block;height:32px;width:auto;" />
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
              <p style="margin:0 0 14px 0;">Salut Maé,</p>
              <p style="margin:0 0 14px 0;">
                Tu es officiellement sur le plan <strong style="color:#fff;">${PLAN_LABEL[PLAN]}</strong>
                (${PRICE[PLAN]}&nbsp;€/mois). Merci de soutenir Upcut — ton accès est déjà actif.
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
                    <p style="margin:0 0 6px 0;font-size:12px;letter-spacing:0.1em;text-transform:uppercase;color:#5eead4;font-weight:700;">Plan ${PLAN_LABEL[PLAN]}</p>
                    <p style="margin:0;font-size:15px;line-height:1.5;color:#e8e9ed;">${PLAN_BLURB[PLAN]}</p>
                    <p style="margin:10px 0 0 0;font-size:14px;color:#aeb2bd;">
                      ${CREDITS[PLAN]} crédits ce mois-ci · 1 crédit = 1&nbsp;min de vidéo source
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:26px 28px 8px 28px;" align="center">
              <a href="${SITE}/dashboard" style="display:inline-block;background:#2dd4bf;color:#042f2e;text-decoration:none;font-weight:700;font-size:15px;padding:12px 22px;border-radius:999px;">
                Ouvrir mon dashboard
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 28px 28px;font-size:14px;line-height:1.6;color:#9aa0ad;" align="center">
              <p style="margin:0 0 10px 0;">
                Tu peux gérer ou résilier ton abonnement à tout moment dans
                <a href="${SITE}/parametres" style="color:#5eead4;text-decoration:underline;">Paramètres</a>.
              </p>
              <p style="margin:0;">Une question&nbsp;? Réponds simplement à cet email — on lit tout.</p>
            </td>
          </tr>
        </table>
        <p style="margin:18px 0 0 0;font-size:12px;color:#6b7280;">
          Upcut · <a href="${SITE}" style="color:#6b7280;text-decoration:underline;">upcut.app</a>
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;

const apiKey = process.env.RESEND_API_KEY?.trim();
if (!apiKey) {
  console.error(
    "RESEND_API_KEY manquant. Ajoute-le dans .env.local puis relance ce script."
  );
  process.exit(1);
}

const from = process.env.RESEND_FROM?.trim() || "Upcut <onboarding@resend.dev>";
const resend = new Resend(apiKey);

const { data, error } = await resend.emails.send({
  from,
  to: [PREVIEW_TO],
  subject: `[PREVIEW] ${subject}`,
  html,
  text,
  replyTo: "mae.prina@gmail.com",
});

if (error) {
  console.error("Envoi échoué:", error);
  process.exit(1);
}

console.log(`OK — mail de remerciement envoyé à ${PREVIEW_TO} (id: ${data?.id})`);
