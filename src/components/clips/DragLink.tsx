"use client";

import { useRef, type ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { mountReuseDragPreview } from "@/components/clips/reuse-drag-preview";

type DragLinkProps = {
  href: string;
  url: string | null;
  title: string;
  thumb: string | null;
  className?: string;
  children: ReactNode;
};

export function DragLink({ href, url, title, thumb, className, children }: DragLinkProps) {
  const previewRef = useRef<HTMLDivElement | null>(null);
  const suppressClickRef = useRef(false);

  return (
    <Link
      href={href}
      draggable={Boolean(url)}
      className={cn(className, url && "cursor-grab active:cursor-grabbing")}
      onDragStart={(event) => {
        if (!url) return;
        event.dataTransfer.setData("text/uri-list", url);
        event.dataTransfer.setData("text/plain", url);
        event.dataTransfer.effectAllowed = "copy";
        const preview = mountReuseDragPreview(title, thumb);
        previewRef.current = preview;
        event.dataTransfer.setDragImage(preview, 24, 18);
        suppressClickRef.current = true;
      }}
      onDragEnd={() => {
        previewRef.current?.remove();
        previewRef.current = null;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 50);
      }}
      onClick={(event) => {
        if (!suppressClickRef.current) return;
        suppressClickRef.current = false;
        event.preventDefault();
      }}
    >
      {children}
    </Link>
  );
}
