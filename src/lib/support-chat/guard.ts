import type { SupportLocale } from "@/lib/support-chat/prompt";

export const MAX_MESSAGE_CHARS = 500;
export const MAX_HISTORY_TURNS = 8;
export const MAX_HISTORY_CHARS = 800;

const JAILBREAK = [
  /ignore\s+(all\s+)?(previous|above|prior)\s+(instructions|prompts)/i,
  /oublie\s+(tes|les|toutes?\s+tes)\s+(instructions|règles|consignes)/i,
  /ignore\s+(tes|les)\s+instructions/i,
  /you\s+are\s+now\b/i,
  /tu\s+es\s+maintenant\b/i,
  /\bDAN\b/,
  /developer\s+mode/i,
  /jailbreak/i,
  /reveal\s+(your\s+)?(system\s+)?prompt/i,
  /show\s+(me\s+)?(the\s+)?system\s+prompt/i,
  /affiche\s+(moi\s+)?(le\s+)?(system\s+)?prompt/i,
  /nouveau\s+prompt\s+syst[eè]me/i,
];

const CODE_REQUEST = [
  /\b(write|generate|give me|create)\b.{0,80}\b(python|javascript|typescript|java\b|c\+\+|golang|dockerfile|sql query)\b/i,
  /\b(écris|génère|donne[- ]moi|crée)\b.{0,80}\b(python|javascript|typescript|java\b|c\+\+|sql)\b/i,
  /```(?:python|javascript|typescript|js|ts|bash|sh|sql|html|css)\b/i,
];

export type ChatTurn = { role: "user" | "assistant"; content: string };

export function isAbuseAttempt(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return JAILBREAK.some((r) => r.test(t)) || CODE_REQUEST.some((r) => r.test(t));
}

export function parseLocale(value: unknown): SupportLocale {
  return value === "en" ? "en" : "fr";
}

export function normalizeMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (text.length > MAX_MESSAGE_CHARS) return text.slice(0, MAX_MESSAGE_CHARS);
  return text;
}

export function normalizeHistory(value: unknown): ChatTurn[] {
  if (!Array.isArray(value)) return [];
  const out: ChatTurn[] = [];
  for (const item of value.slice(-MAX_HISTORY_TURNS * 2)) {
    if (!item || (item.role !== "user" && item.role !== "assistant")) continue;
    if (typeof item.content !== "string") continue;
    const content = item.content.trim().slice(0, MAX_HISTORY_CHARS);
    if (!content) continue;
    out.push({ role: item.role, content });
    if (out.length >= MAX_HISTORY_TURNS) break;
  }
  return out;
}

export function sanitizeAssistantReply(text: string, fallback: string): string {
  const trimmed = text.trim();
  if (!trimmed) return fallback;
  if (/UPCUT_SYS_LOCK/i.test(trimmed)) return fallback;
  if (/```(?:python|javascript|typescript|js|ts|bash|sh|sql|html|css)\b/i.test(trimmed)) {
    return fallback;
  }
  return trimmed.slice(0, 4000);
}
