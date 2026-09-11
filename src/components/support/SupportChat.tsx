"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, MessageCircle, Send, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "cut" | "light" | "app";
type ChatTurn = { role: "user" | "assistant"; content: string };

const APP_PREFIXES = [
  "/dashboard",
  "/projets",
  "/parametres",
  "/clips",
  "/upgrade",
  "/checkout",
  "/analyse",
];

function toneForPath(pathname: string | null): Tone {
  if (!pathname) return "cut";
  if (APP_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return "app";
  }
  return "cut";
}

export function SupportChatHost() {
  const pathname = usePathname();
  return <SupportChat tone={toneForPath(pathname)} />;
}

export function SupportChat({ tone }: { tone: Tone }) {
  const t = useTranslations("supportChat");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamingRef = useRef(false);
  const queueRef = useRef("");

  const suggestions = t.raw("suggestions") as string[];

  const ui = useMemo(() => {
    if (tone === "cut") {
      return {
        fab: "bg-[#fdfff0] text-[#100e0e] hover:bg-white",
        panel:
          "border-[#212121] bg-[#181616] text-[#fdfff0] shadow-[0_16px_40px_-20px_rgba(0,0,0,0.7)]",
        header: "border-[#212121]",
        muted: "text-[#fdfff0]/45",
        user: "bg-[#fdfff0] text-[#100e0e]",
        bot: "bg-[#100e0e] text-[#fdfff0]/85",
        input:
          "border-[#212121] bg-[#100e0e] text-[#fdfff0] placeholder:text-[#fdfff0]/35 focus-visible:border-[#fdfff0]/40",
        send: "bg-[#fdfff0] text-[#100e0e] hover:bg-white disabled:opacity-40",
        chip: "border-[#212121] bg-[#100e0e] text-[#fdfff0]/75 hover:border-[#2a2a2a]",
        close: "text-[#fdfff0]/55 hover:bg-[#100e0e] hover:text-[#fdfff0]",
      };
    }
    if (tone === "light") {
      return {
        fab: "bg-[#100e0e] text-[#fdfff0] hover:bg-[#181616]",
        panel:
          "border-[#e5e5e7] bg-white text-[#100e0e] shadow-[0_16px_40px_-18px_rgba(16,14,14,0.35)]",
        header: "border-[#e5e5e7]",
        muted: "text-[#100e0e]/45",
        user: "bg-[#100e0e] text-[#fdfff0]",
        bot: "bg-[#f4f4f0] text-[#100e0e]/85",
        input:
          "border-[#e5e5e7] bg-[#fafafa] text-[#100e0e] placeholder:text-[#100e0e]/35 focus-visible:border-[#100e0e]/40",
        send: "bg-[#100e0e] text-[#fdfff0] hover:bg-[#181616] disabled:opacity-40",
        chip: "border-[#e5e5e7] bg-[#fafafa] text-[#100e0e]/70 hover:border-[#d2d2d7]",
        close: "text-[#100e0e]/45 hover:bg-[#f4f4f0] hover:text-[#100e0e]",
      };
    }
    return {
      fab: "bg-primary text-primary-foreground hover:bg-primary/90",
      panel: "border-border bg-card text-foreground shadow-xl",
      header: "border-border",
      muted: "text-muted-foreground",
      user: "bg-primary text-primary-foreground",
      bot: "bg-muted text-foreground/90",
      input:
        "border-border bg-background text-foreground placeholder:text-muted-foreground focus-visible:border-primary/40",
      send: "bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40",
      chip: "border-border bg-background text-muted-foreground hover:text-foreground",
      close: "text-muted-foreground hover:bg-muted hover:text-foreground",
    };
  }, [tone]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeChat();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, pending, open]);

  function setAssistantContent(content: string) {
    setMessages((prev) => {
      const copy = [...prev];
      const last = copy.length - 1;
      if (last < 0 || copy[last].role !== "assistant") {
        copy.push({ role: "assistant", content });
        return copy;
      }
      copy[last] = { role: "assistant", content };
      return copy;
    });
  }

  async function pumpTypewriter(accRef: { text: string }, streamOpen: { current: boolean }) {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const takeBurst = (queue: string) => {
      if (!queue) return { bit: "", rest: "" };
      if (queue[0] === "\n") {
        const nl = queue.startsWith("\n\n") ? 2 : 1;
        return { bit: queue.slice(0, nl), rest: queue.slice(nl) };
      }
      if (/\s/.test(queue[0] ?? "")) {
        return { bit: queue[0], rest: queue.slice(1) };
      }
      const cap = 2 + Math.floor(Math.random() * 5);
      const chunk = queue.slice(0, cap);
      const breakAt = chunk.search(/[\s.,!?;:…]/);
      const n = breakAt > 0 ? breakAt : chunk.length;
      return { bit: queue.slice(0, n), rest: queue.slice(n) };
    };

    const delayFor = (bit: string, backlog: number) => {
      const last = bit[bit.length - 1] ?? "";
      const jitter = Math.random() * 16;
      if (bit.includes("\n\n") || /[.!?…]/.test(last)) return 150 + Math.random() * 90;
      if (/[,:;]/.test(last)) return 55 + jitter;
      if (backlog > 220) return 8 + jitter * 0.35;
      if (backlog > 90) return 14 + jitter * 0.5;
      return 20 + jitter;
    };

    while (streamOpen.current || queueRef.current.length > 0) {
      if (!streamingRef.current) {
        queueRef.current = "";
        break;
      }
      if (!queueRef.current) {
        await sleep(20);
        continue;
      }
      const { bit, rest } = takeBurst(queueRef.current);
      queueRef.current = rest;
      accRef.text += bit;
      setAssistantContent(accRef.text);
      await sleep(delayFor(bit, queueRef.current.length));
    }
  }

  async function send(text: string) {
    const message = text.replace(/\s+/g, " ").trim();
    if (!message || pending) return;

    streamingRef.current = true;
    queueRef.current = "";
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setInput("");
    setPending(true);
    setError(null);

    const acc = { text: "" };
    const streamOpen = { current: true };
    const typing = pumpTypewriter(acc, streamOpen);

    try {
      const res = await fetch("/api/support-chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-upcut-locale": locale === "en" ? "en" : "fr",
        },
        body: JSON.stringify({
          message,
          locale: locale === "en" ? "en" : "fr",
          history: messages,
        }),
      });
      if (res.status === 429) {
        streamOpen.current = false;
        queueRef.current = "";
        setError(t("errorRate"));
        return;
      }
      if (!res.ok || !res.body) {
        streamOpen.current = false;
        queueRef.current = "";
        setError(t("errorGeneric"));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (streamingRef.current) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const event of events) {
          const line = event
            .split("\n")
            .map((l) => l.replace(/^data:\s?/, "").trim())
            .filter(Boolean)
            .join("");
          if (!line || line === "[DONE]" || line === '"[DONE]"') continue;
          let payload: { t?: string; reset?: string; error?: string };
          try {
            payload = JSON.parse(line) as typeof payload;
          } catch {
            continue;
          }
          if (payload.error === "rate_limited") {
            streamOpen.current = false;
            queueRef.current = "";
            setError(t("errorRate"));
            return;
          }
          if (typeof payload.reset === "string") {
            queueRef.current = "";
            acc.text = payload.reset;
            setAssistantContent(payload.reset);
            continue;
          }
          if (typeof payload.t === "string" && payload.t) {
            queueRef.current += payload.t;
          }
        }
      }

      streamOpen.current = false;
      await typing;

      if (!acc.text.trim()) {
        setError(t("errorGeneric"));
      }
    } catch {
      streamOpen.current = false;
      queueRef.current = "";
      setError(t("errorGeneric"));
    } finally {
      streamOpen.current = false;
      streamingRef.current = false;
      setPending(false);
    }
  }

  function openChat() {
    setMounted(true);
    setOpen(true);
  }

  function closeChat() {
    setOpen(false);
  }

  function onPanelAnimationEnd(e: React.AnimationEvent<HTMLElement>) {
    if (e.target !== e.currentTarget) return;
    if (!open) setMounted(false);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    void send(input);
  }

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[80] sm:bottom-5 sm:right-5">
      {mounted ? (
        <section
          className={cn(
            "pointer-events-auto absolute bottom-0 right-0 flex w-[min(24rem,calc(100vw-1.75rem))] flex-col overflow-hidden rounded-2xl border",
            "h-[min(32rem,calc(100dvh-6rem))]",
            open ? "support-panel-in" : "support-panel-out",
            ui.panel
          )}
          role="dialog"
          aria-label={t("title")}
          onAnimationEnd={onPanelAnimationEnd}
        >
          <header
            className={cn(
              "flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3",
              ui.header
            )}
          >
            <div className="min-w-0">
              <p className="text-[15px] font-medium tracking-tight">{t("title")}</p>
              <p className={cn("text-[12px]", ui.muted)}>{t("subtitle")}</p>
            </div>
            <button
              type="button"
              onClick={closeChat}
              className={cn(
                "inline-flex size-8 items-center justify-center rounded-full transition-colors",
                ui.close
              )}
              aria-label={t("close")}
            >
              <X className="size-4" />
            </button>
          </header>

          <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
            <div className={cn("max-w-[92%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed", ui.bot)}>
              <p className="whitespace-pre-wrap">{t("welcome")}</p>
            </div>

            {messages.length === 0 ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {suggestions.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => void send(q)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-left text-[12.5px] transition-colors",
                      ui.chip
                    )}
                  >
                    {q}
                  </button>
                ))}
              </div>
            ) : null}

            {messages.map((m, i) => {
              if (m.role === "assistant" && !m.content) return null;
              const streaming =
                pending && i === messages.length - 1 && m.role === "assistant";
              return (
                <div
                  key={`${m.role}-${i}`}
                  className={cn(
                    "max-w-[92%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed",
                    m.role === "user" ? `ml-auto ${ui.user}` : `${ui.bot} support-bubble-in`
                  )}
                >
                  {m.content}
                  {streaming ? (
                    <span
                      className="support-caret ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[2px] bg-current align-text-bottom"
                      aria-hidden
                    />
                  ) : null}
                </div>
              );
            })}
            {pending && messages[messages.length - 1]?.role === "user" ? (
              <div className={cn("flex items-center gap-1 py-1", ui.muted)} aria-hidden>
                <span className="support-dot size-1.5 rounded-full bg-current" />
                <span className="support-dot size-1.5 rounded-full bg-current [animation-delay:160ms]" />
                <span className="support-dot size-1.5 rounded-full bg-current [animation-delay:320ms]" />
              </div>
            ) : null}
            {error ? <p className="text-[12.5px] text-red-500">{error}</p> : null}
          </div>

          <form
            onSubmit={onSubmit}
            className={cn("shrink-0 border-t p-3", ui.header)}
          >
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                maxLength={500}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                placeholder={t("placeholder")}
                className={cn(
                  "max-h-24 min-h-10 flex-1 resize-none rounded-xl border px-3 py-2.5 text-[13.5px] outline-none",
                  ui.input
                )}
              />
              <button
                type="submit"
                disabled={pending || !input.trim()}
                className={cn(
                  "inline-flex size-10 shrink-0 items-center justify-center rounded-full transition-colors",
                  ui.send
                )}
                aria-label={t("send")}
              >
                {pending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <button
        type="button"
        onClick={openChat}
        className={cn(
          "support-fab pointer-events-auto relative inline-flex size-12 items-center justify-center rounded-full shadow-lg",
          ui.fab,
          open
            ? "pointer-events-none scale-75 opacity-0"
            : "scale-100 opacity-100"
        )}
        aria-label={t("open")}
        tabIndex={open ? -1 : 0}
        aria-hidden={open}
      >
        <MessageCircle className="size-5" />
      </button>
    </div>
  );
}
