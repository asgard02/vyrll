import { NextRequest, NextResponse } from "next/server";
import {
  isEmailConfigured,
  sendSubscriptionThanksEmail,
} from "@/lib/email/send";
import { isPaidPlanId } from "@/lib/stripe-plans";

/**
 * POST /api/emails/preview-thanks
 * Sends the subscription thank-you preview to mae.prina@gmail.com.
 * Body optional: { plan?: "creator" | "studio", username?: string }
 * Protect with PREVIEW_EMAIL_SECRET if set (header x-preview-secret).
 */
export async function POST(request: NextRequest) {
  const secret = process.env.PREVIEW_EMAIL_SECRET?.trim();
  const provided = request.headers.get("x-preview-secret")?.trim();
  // Require an explicit secret so the public route cannot be abused once Resend is live.
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }

  if (!isEmailConfigured()) {
    return NextResponse.json(
      {
        error:
          "RESEND_API_KEY manquant. Ajoute-le dans .env.local / Railway puis réessaie.",
      },
      { status: 503 }
    );
  }

  let plan: "creator" | "studio" = "creator";
  let username: string | null = "Maé";
  try {
    const body = await request.json().catch(() => ({}));
    if (isPaidPlanId(body?.plan)) plan = body.plan;
    if (typeof body?.username === "string" && body.username.trim()) {
      username = body.username.trim();
    }
  } catch {
    /* defaults */
  }

  // Recipient is forced to mae.prina@gmail.com while preview mode is on.
  const result = await sendSubscriptionThanksEmail({
    to: "mae.prina@gmail.com",
    plan,
    username,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  return NextResponse.json({
    success: true,
    id: result.id,
    to: result.previewTo ?? "mae.prina@gmail.com",
    plan,
  });
}
