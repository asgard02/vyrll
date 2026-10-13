"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

type ReportError = "invalid" | "rate" | "unavailable" | "send";

function isReportError(value: string): value is ReportError {
  return (
    value === "invalid" ||
    value === "rate" ||
    value === "unavailable" ||
    value === "send"
  );
}

export function ContentReportForm() {
  const t = useTranslations("legal.report");
  const [name, setName] = useState("");
  const [link, setLink] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messageFor = (code: ReportError): string => {
    switch (code) {
      case "invalid":
        return t("invalid");
      case "rate":
        return t("rate");
      case "unavailable":
        return t("unavailable");
      case "send":
        return t("error");
      default: {
        const exhaustive: never = code;
        return exhaustive;
      }
    }
  };

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/signalement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, link, reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = typeof data?.error === "string" ? data.error : "send";
        setError(isReportError(code) ? messageFor(code) : t("error"));
        return;
      }
      setSent(true);
    } catch {
      setError(t("error"));
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return <p className="text-sm text-muted-foreground">{t("success")}</p>;
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="space-y-5">
      <label className="block space-y-2">
        <span className="text-[13px] font-medium text-foreground">{t("name")}</span>
        <input
          name="name"
          type="text"
          required
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="name"
          className="h-11 w-full rounded-xl border border-border bg-background px-3.5 text-sm text-foreground outline-none focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/15"
        />
      </label>
      <label className="block space-y-2">
        <span className="text-[13px] font-medium text-foreground">{t("link")}</span>
        <input
          name="link"
          type="url"
          required
          maxLength={2000}
          value={link}
          onChange={(event) => setLink(event.target.value)}
          placeholder="https://"
          className="h-11 w-full rounded-xl border border-border bg-background px-3.5 text-sm text-foreground outline-none focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/15"
        />
      </label>
      <label className="block space-y-2">
        <span className="text-[13px] font-medium text-foreground">{t("reason")}</span>
        <textarea
          name="reason"
          required
          maxLength={2000}
          rows={5}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="w-full rounded-xl border border-border bg-background px-3.5 py-3 text-sm text-foreground outline-none focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/15"
        />
      </label>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <button
        type="submit"
        disabled={loading}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-primary px-5 text-[14px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
      >
        {loading ? <Loader2 className="size-4 animate-spin" /> : null}
        {loading ? t("sending") : t("submit")}
      </button>
    </form>
  );
}
