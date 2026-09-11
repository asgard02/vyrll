import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/supabase/server-user";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  buildSupportSystemPrompt,
  cannedRefusal,
  cannedUnavailable,
  type SupportVisitorContext,
} from "@/lib/support-chat/prompt";
import {
  isAbuseAttempt,
  normalizeHistory,
  normalizeMessage,
  parseLocale,
} from "@/lib/support-chat/guard";
import { clientIp, isRateLimited } from "@/lib/support-chat/rate-limit";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = process.env.SUPPORT_CHAT_MODEL?.trim() || "gpt-4o-mini";
const OPENAI_TIMEOUT_MS = 45_000;
const BLOCKED_OUTPUT =
  /```(?:python|javascript|typescript|js|ts|bash|sh|sql|html|css)\b/i;

function sseHeaders(): HeadersInit {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };
}

function encodeSse(payload: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
}

const SSE_DONE = new TextEncoder().encode("data: [DONE]\n\n");

function sseText(text: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (text) controller.enqueue(encodeSse({ t: text }));
      controller.enqueue(SSE_DONE);
      controller.close();
    },
  });
  return new Response(stream, { headers: sseHeaders() });
}

async function visitorContext(
  locale: SupportVisitorContext["locale"]
): Promise<SupportVisitorContext> {
  const ctx: SupportVisitorContext = {
    locale,
    plan: null,
    creditsUsed: null,
    creditsLimit: null,
  };
  if (!isSupabaseConfigured()) return ctx;
  try {
    const supabase = await createClient();
    const { user } = await getServerUser(supabase);
    if (!user) return ctx;
    const { data } = await supabase
      .from("profiles")
      .select("plan, credits_used, credits_limit")
      .eq("id", user.id)
      .maybeSingle();
    if (!data) return ctx;
    ctx.plan = typeof data.plan === "string" ? data.plan : "free";
    ctx.creditsUsed =
      typeof data.credits_used === "number" ? data.credits_used : 0;
    ctx.creditsLimit =
      typeof data.credits_limit === "number" ? data.credits_limit : null;
  } catch {
    /* visiteur anonyme si la session n’est pas lisible */
  }
  return ctx;
}

export async function POST(request: NextRequest) {
  const locale = parseLocale(request.headers.get("x-upcut-locale"));

  try {
    if (isRateLimited(clientIp(request.headers))) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return sseText(cannedUnavailable(locale));
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "invalid" }, { status: 400 });
    }

    const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const message = normalizeMessage(payload.message);
    if (!message) {
      return NextResponse.json({ error: "invalid" }, { status: 400 });
    }

    if (isAbuseAttempt(message)) {
      return sseText(cannedRefusal(locale));
    }

    const history = normalizeHistory(payload.history);
    const bodyLocale =
      typeof payload.locale === "string" ? parseLocale(payload.locale) : locale;
    const ctx = await visitorContext(bodyLocale);

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), OPENAI_TIMEOUT_MS);

    let completion: Response;
    try {
      completion = await fetch(OPENAI_URL, {
        method: "POST",
        signal: abort.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0.25,
          max_tokens: 900,
          stream: true,
          messages: [
            { role: "system", content: buildSupportSystemPrompt(ctx) },
            ...history,
            { role: "user", content: message },
          ],
        }),
      });
    } catch {
      clearTimeout(timer);
      return sseText(cannedUnavailable(locale));
    }

    if (!completion.ok || !completion.body) {
      clearTimeout(timer);
      console.error("support-chat openai status", completion.status);
      return sseText(cannedUnavailable(locale));
    }

    const reader = completion.body.getReader();
    const decoder = new TextDecoder();
    const refusal = cannedRefusal(locale);
    const unavailable = cannedUnavailable(locale);

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let buf = "";
        let acc = "";
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop() ?? "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data:")) continue;
              const data = trimmed.slice(5).trim();
              if (!data || data === "[DONE]") continue;
              let json: {
                choices?: { delta?: { content?: string | null } }[];
              };
              try {
                json = JSON.parse(data) as typeof json;
              } catch {
                continue;
              }
              const piece = json.choices?.[0]?.delta?.content;
              if (typeof piece !== "string" || !piece) continue;
              acc += piece;
              if (acc.length > 4000 || BLOCKED_OUTPUT.test(acc)) {
                controller.enqueue(encodeSse({ reset: refusal }));
                acc = refusal;
                return;
              }
              controller.enqueue(encodeSse({ t: piece }));
            }
          }
          if (!acc.trim()) {
            controller.enqueue(encodeSse({ t: unavailable }));
          }
        } catch {
          if (!acc.trim()) controller.enqueue(encodeSse({ t: unavailable }));
        } finally {
          clearTimeout(timer);
          controller.enqueue(SSE_DONE);
          controller.close();
          try {
            reader.releaseLock();
          } catch {
            /* already released */
          }
        }
      },
      cancel() {
        clearTimeout(timer);
        abort.abort();
        try {
          reader.releaseLock();
        } catch {
          /* already released */
        }
      },
    });

    return new Response(stream, { headers: sseHeaders() });
  } catch (err) {
    console.error("support-chat error", err);
    return sseText(cannedUnavailable(locale));
  }
}
