import { Resend } from "resend";
import type { PaidPlanId } from "@/lib/stripe-plans";
import {
  buildSubscriptionThanksHtml,
  buildSubscriptionThanksText,
  subscriptionThanksSubject,
} from "@/lib/email/subscription-thanks";

/** Preview inbox — never email real subscribers until this is cleared. */
const PREVIEW_TO = "mae.prina@gmail.com";

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

function fromAddress(): string {
  return (
    process.env.RESEND_FROM?.trim() ||
    "Upcut <onboarding@resend.dev>"
  );
}

/**
 * Sends the subscription thank-you email.
 * While SUBSCRIPTION_THANKS_PREVIEW=1 (default until go-live), always delivers
 * to mae.prina@gmail.com instead of the subscriber.
 */
export async function sendSubscriptionThanksEmail(opts: {
  to: string;
  plan: PaidPlanId;
  username?: string | null;
}): Promise<{ ok: true; id?: string; previewTo?: string } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY manquant." };
  }

  const previewMode =
    process.env.SUBSCRIPTION_THANKS_PREVIEW !== "0" &&
    process.env.SUBSCRIPTION_THANKS_PREVIEW !== "false";

  const to = previewMode ? PREVIEW_TO : opts.to.trim();
  if (!to) {
    return { ok: false, error: "Destinataire email manquant." };
  }

  const resend = new Resend(apiKey);
  const subject = subscriptionThanksSubject(opts.plan);
  const html = buildSubscriptionThanksHtml({
    plan: opts.plan,
    username: opts.username,
  });
  const text = buildSubscriptionThanksText({
    plan: opts.plan,
    username: opts.username,
  });

  const { data, error } = await resend.emails.send({
    from: fromAddress(),
    to: [to],
    subject: previewMode
      ? `[PREVIEW → ${opts.to}] ${subject}`
      : subject,
    html,
    text,
    replyTo: process.env.RESEND_REPLY_TO?.trim() || "mae.prina@gmail.com",
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  return {
    ok: true,
    id: data?.id,
    previewTo: previewMode ? PREVIEW_TO : undefined,
  };
}
