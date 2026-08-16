"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { FileVideo, Link2, Loader2, Scissors, Upload, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { isValidVideoUrl } from "@/lib/youtube";
import { useTypewriterPlaceholder } from "@/lib/useTypewriterPlaceholder";

export type CreateClipInputMode = "url" | "upload";

export type UploadedFileState = {
  upload_id: string;
  duration_seconds: number;
  filename: string;
};

type CreateClipBarProps = {
  inputMode: CreateClipInputMode;
  onInputModeChange: (mode: CreateClipInputMode) => void;
  url: string;
  onUrlChange: (url: string) => void;
  uploadedFile: UploadedFileState | null;
  onClearUpload: () => void;
  onFileSelected: (file: File) => void;
  uploadingFile: boolean;
  onGenerate: () => void;
  generateDisabled: boolean;
  quotaExhausted: boolean;
  submitError: string;
  uploadError: string;
  bannerMessage?: string | null;
  bannerTone?: "error" | "warn";
  quotaMessage?: ReactNode;
};

const PILL_SHELL =
  "flex flex-col gap-2 rounded-full border border-border bg-card p-1.5 shadow-[0_1px_2px_-1px_rgba(28,28,30,0.12),0_2px_5px_rgba(28,28,30,0.04)] transition-all focus-within:border-input focus-within:ring-4 focus-within:ring-primary/8 max-sm:rounded-3xl sm:flex-row";

const PILL_BTN =
  "flex h-13 shrink-0 items-center justify-center gap-2 rounded-full bg-[#6d28d9] px-6 text-sm font-semibold text-white shadow-[0_8px_20px_-10px_rgba(109,40,217,0.5)] transition-all hover:bg-[#5b21b6] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none max-sm:rounded-2xl";

/**
 * Create composer — same geometry as landing HeroUrlForm (rounded-full, h-13).
 * Opens options overlay via onGenerate; does not start a job itself.
 */
export function CreateClipBar({
  inputMode,
  onInputModeChange,
  url,
  onUrlChange,
  uploadedFile,
  onClearUpload,
  onFileSelected,
  uploadingFile,
  onGenerate,
  generateDisabled,
  quotaExhausted,
  submitError,
  uploadError,
  bannerMessage,
  bannerTone = "warn",
  quotaMessage,
}: CreateClipBarProps) {
  const t = useTranslations("dashboard");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [localError, setLocalError] = useState("");
  const placeholders = t.raw("source.placeholders") as Record<string, string>;
  const examples = useMemo(
    () => [placeholders.youtube, placeholders.twitch, placeholders.paste, placeholders.short],
    [placeholders.youtube, placeholders.twitch, placeholders.paste, placeholders.short]
  );
  const typedPh = useTypewriterPlaceholder(inputMode === "url" && !url && !quotaExhausted, examples);

  const errorText = localError || submitError || uploadError;

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || !isValidVideoUrl(trimmed)) {
      setLocalError(t("errors.invalidUrl"));
      return;
    }
    setLocalError("");
    if (!generateDisabled) onGenerate();
  };

  return (
    <div className="flex w-full max-w-[540px] flex-col items-center">
      <div
        className="mb-5 inline-flex rounded-full border border-border bg-muted p-1"
        role="tablist"
        aria-label={t("source.modeAriaLabel")}
      >
        <button
          type="button"
          role="tab"
          aria-selected={inputMode === "url"}
          onClick={() => {
            setLocalError("");
            onInputModeChange("url");
          }}
          className={`rounded-full px-5 py-2 text-[14px] font-medium transition-colors ${
            inputMode === "url"
              ? "bg-card text-foreground shadow-[0_1px_2px_rgba(28,28,30,0.08)]"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t("source.urlTitle")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={inputMode === "upload"}
          onClick={() => {
            setLocalError("");
            onInputModeChange("upload");
          }}
          className={`rounded-full px-5 py-2 text-[14px] font-medium transition-colors ${
            inputMode === "upload"
              ? "bg-card text-foreground shadow-[0_1px_2px_rgba(28,28,30,0.08)]"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t("source.uploadTitle")}
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.webm,.mkv"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFileSelected(file);
          e.target.value = "";
        }}
      />

      {inputMode === "url" && (
        <form className="w-full" onSubmit={handleUrlSubmit}>
          <div className={PILL_SHELL}>
            <div className="relative min-w-0 flex-1">
              <Link2 className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={url}
                onChange={(e) => {
                  onUrlChange(e.target.value);
                  setLocalError("");
                }}
                placeholder=""
                aria-label={t("source.urlPlaceholder")}
                disabled={quotaExhausted}
                className="h-13 w-full rounded-full bg-transparent pl-11 pr-4 text-base text-foreground outline-none disabled:opacity-50"
                autoComplete="url"
              />
              {!url && !quotaExhausted && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute left-11 top-1/2 -translate-y-1/2 select-none text-base text-muted-foreground"
                >
                  {typedPh}
                  <span className="ml-px inline-block h-[1em] w-[1.5px] animate-blink align-middle bg-foreground/30" />
                </span>
              )}
            </div>
            <button
              type="submit"
              disabled={generateDisabled}
              className={PILL_BTN}
            >
              <Scissors className="size-4" />
              {t("actions.generate")}
            </button>
          </div>
        </form>
      )}

      {inputMode === "upload" && (
        <div className="w-full">
          {!uploadedFile ? (
            <div
              className={`${PILL_SHELL} ${
                isDragOver ? "border-primary ring-4 ring-primary/8" : ""
              } ${uploadingFile ? "pointer-events-none opacity-60" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragOver(false);
                const file = e.dataTransfer.files?.[0];
                if (file) onFileSelected(file);
              }}
            >
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="relative flex h-13 min-w-0 flex-1 items-center rounded-full px-4 text-left"
              >
                {uploadingFile ? (
                  <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
                ) : (
                  <Upload className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate pl-3 text-base text-muted-foreground">
                  {uploadingFile ? t("upload.inProgress") : t("upload.pillPlaceholder")}
                </span>
              </button>
              <button type="button" disabled className={PILL_BTN}>
                <Scissors className="size-4" />
                {t("actions.generate")}
              </button>
            </div>
          ) : (
            <div className={PILL_SHELL}>
              <div className="flex h-13 min-w-0 flex-1 items-center gap-3 px-4">
                <FileVideo className="size-4 shrink-0 text-muted-foreground" />
                <p className="min-w-0 flex-1 truncate text-base text-foreground">
                  {uploadedFile.filename}
                </p>
                <button
                  type="button"
                  onClick={onClearUpload}
                  className="shrink-0 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label={t("upload.clearAria")}
                >
                  <X className="size-4" />
                </button>
              </div>
              <button
                type="button"
                disabled={generateDisabled}
                onClick={() => {
                  if (!generateDisabled) onGenerate();
                }}
                className={PILL_BTN}
              >
                <Scissors className="size-4" />
                {t("actions.generate")}
              </button>
            </div>
          )}
        </div>
      )}

      {quotaMessage ? <div className="mt-5 flex justify-center">{quotaMessage}</div> : null}

      {bannerMessage ? (
        <p
          className={`mt-4 max-w-[480px] text-center text-[13px] leading-snug ${
            bannerTone === "error" ? "text-destructive" : "text-amber-800 dark:text-amber-300"
          }`}
          role="alert"
        >
          {bannerMessage}
        </p>
      ) : null}

      {errorText ? (
        <p className="mt-4 text-center text-[13px] text-destructive" role="alert">
          {errorText}
        </p>
      ) : null}
    </div>
  );
}
