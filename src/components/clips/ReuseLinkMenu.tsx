"use client";

import { useState } from "react";
import { Link2, MoreHorizontal } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type ReuseLinkMenuProps = {
  menuLabel: string;
  actionLabel: string;
  onReuse: () => void;
  className?: string;
};

export function ReuseLinkMenu({ menuLabel, actionLabel, onReuse, className }: ReuseLinkMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        aria-label={menuLabel}
        onClick={(event) => event.stopPropagation()}
        className={cn(
          "absolute z-20 flex size-7 items-center justify-center rounded-md bg-black/60 text-white hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
          className
        )}
      >
        <MoreHorizontal className="size-4" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 gap-0.5 p-1.5">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            onReuse();
          }}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[14px] text-foreground hover:bg-muted"
        >
          <Link2 className="size-3.5 shrink-0" aria-hidden />
          {actionLabel}
        </button>
      </PopoverContent>
    </Popover>
  );
}
