import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase";

const PLAN_LIMITS: Record<
  string,
  { credits_limit: number; analyses_limit: number }
> = {
  creator: { credits_limit: 90, analyses_limit: 20 },
  studio: { credits_limit: 210, analyses_limit: -1 },
};

const ACTIVATE_EVENTS = new Set([
  "order_created",
  "subscription_created",
  "subscription_updated",
  "subscription_payment_success",
]);

function planFromVariantId(variantId: unknown): "creator" | "studio" | null {
  const id = String(variantId ?? "").trim();
  if (!id) return null;
  const creator = (process.env.LEMONSQUEEZY_VARIANT_CREATOR_ID ?? "").trim();
  const studio = (process.env.LEMONSQUEEZY_VARIANT_STUDIO_ID ?? "").trim();
  if (creator && id === creator) return "creator";
  if (studio && id === studio) return "studio";
  return null;
}

function extractCustomUserId(payload: {
  meta?: { custom_data?: Record<string, unknown> };
  data?: { attributes?: { first_order_item?: { variant_id?: unknown }; variant_id?: unknown } };
}): string | null {
  const custom = payload.meta?.custom_data;
  const raw = custom?.user_id ?? custom?.userId;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return null;
}

function extractVariantId(payload: {
  data?: {
    attributes?: {
      variant_id?: unknown;
      first_order_item?: { variant_id?: unknown };
    };
  };
}): unknown {
  const attrs = payload.data?.attributes;
  return attrs?.variant_id ?? attrs?.first_order_item?.variant_id;
}

export async function POST(request: NextRequest) {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: "Webhook non configuré." },
      { status: 503 }
    );
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase non configuré." },
      { status: 503 }
    );
  }

  const rawBody = await request.text();
  const signature = Buffer.from(
    request.headers.get("X-Signature") ?? "",
    "hex"
  );

  if (signature.length === 0 || rawBody.length === 0) {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }

  const hmac = Buffer.from(
    crypto.createHmac("sha256", secret).update(rawBody).digest("hex"),
    "hex"
  );

  if (hmac.length !== signature.length || !crypto.timingSafeEqual(hmac, signature)) {
    return NextResponse.json({ error: "Signature invalide." }, { status: 400 });
  }

  let payload: {
    meta?: {
      event_name?: string;
      custom_data?: Record<string, unknown>;
    };
    data?: {
      attributes?: {
        variant_id?: unknown;
        first_order_item?: { variant_id?: unknown };
        status?: string;
      };
    };
  };

  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "JSON invalide." }, { status: 400 });
  }

  const eventName = String(payload.meta?.event_name ?? "");
  if (!ACTIVATE_EVENTS.has(eventName)) {
    return NextResponse.json({ ok: true, ignored: eventName });
  }

  // Ignore cancelled/expired subscription_updated
  if (eventName === "subscription_updated") {
    const status = String(payload.data?.attributes?.status ?? "").toLowerCase();
    if (status && !["active", "on_trial", "paid"].includes(status)) {
      return NextResponse.json({ ok: true, ignored: status });
    }
  }

  const userId = extractCustomUserId(payload);
  if (!userId) {
    console.warn("[lemonsqueezy webhook] missing custom_data.user_id");
    return NextResponse.json({ error: "user_id manquant." }, { status: 400 });
  }

  const plan = planFromVariantId(extractVariantId(payload));
  if (!plan) {
    console.warn("[lemonsqueezy webhook] unknown variant_id");
    return NextResponse.json({ error: "Variante inconnue." }, { status: 400 });
  }

  const limits = PLAN_LIMITS[plan];
  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({
      plan,
      status: "active",
      credits_limit: limits.credits_limit,
      analyses_limit: limits.analyses_limit,
    })
    .eq("id", userId);

  if (error) {
    console.error("[lemonsqueezy webhook] profile update failed:", error);
    return NextResponse.json({ error: "Mise à jour profil échouée." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, plan, userId });
}
