"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";

const PERMISSION_EVENT = "trimo-notification-permission";

function permissionSnapshot(): NotificationPermission | "unsupported" {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

function subscribePermission(onStoreChange: () => void) {
  window.addEventListener(PERMISSION_EVENT, onStoreChange);
  return () => window.removeEventListener(PERMISSION_EVENT, onStoreChange);
}

/** Demande la permission dans le clic. granted et denied ne réaffichent pas le bouton. */
export function MomentsNotifyPrompt() {
  const t = useTranslations("clipProject.moments");
  const permission = useSyncExternalStore(
    subscribePermission,
    permissionSnapshot,
    () => "unsupported" as const
  );

  if (permission !== "default") return null;

  return (
    <button
      type="button"
      onClick={() => {
        void Notification.requestPermission().then(() => {
          window.dispatchEvent(new Event(PERMISSION_EVENT));
        });
      }}
      className="inline-flex h-10 items-center justify-center rounded-full border border-border bg-background px-4 text-[14px] font-medium text-foreground hover:bg-muted"
    >
      {t("notifyAsk")}
    </button>
  );
}
