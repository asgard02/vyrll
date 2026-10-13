import { NextRequest, NextResponse } from "next/server";
import { CONTACT_EMAIL } from "@/lib/contact";
import {
  isTransactionalMailConfigured,
  sendTransactionalEmail,
} from "@/lib/transactional-mail";

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

const reportHits = new Map<string, { count: number; resetAt: number }>();

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "unknown";
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = reportHits.get(ip);
  if (!entry || now >= entry.resetAt) {
    reportHits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  if (entry.count >= RATE_LIMIT_MAX) return true;
  entry.count += 1;
  return false;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    if (isRateLimited(clientIp(request))) {
      return NextResponse.json({ error: "rate" }, { status: 429 });
    }

    if (!isTransactionalMailConfigured()) {
      return NextResponse.json({ error: "unavailable" }, { status: 503 });
    }

    const body = await request.json().catch(() => ({}));
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const link = typeof body?.link === "string" ? body.link.trim() : "";
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";

    if (
      name.length < 1 ||
      name.length > 120 ||
      link.length < 1 ||
      link.length > 2000 ||
      !isHttpUrl(link) ||
      reason.length < 1 ||
      reason.length > 2000
    ) {
      return NextResponse.json({ error: "invalid" }, { status: 400 });
    }

    const sent = await sendTransactionalEmail({
      to: CONTACT_EMAIL,
      subject: "Signalement de contenu TrimoAI",
      text: `Nom : ${name}\nLien : ${link}\nMotif :\n${reason}\n`,
    });

    if (!sent.ok) {
      console.error("[signalement]", sent.error);
      return NextResponse.json({ error: "send" }, { status: 502 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[signalement]", err);
    return NextResponse.json({ error: "send" }, { status: 500 });
  }
}
