import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export function ExploreBackLink({ label }: { label: string }) {
  return (
    <div className="mx-auto w-full max-w-2xl px-6 pt-8 sm:pt-10">
      <Link
        href="/explore"
        className="group inline-flex items-center gap-1.5 text-[13px] font-medium text-[#1d1d1f]/50 transition-colors hover:text-[#6d28d9]"
      >
        <ArrowLeft
          className="size-3.5 transition-transform duration-200 ease-out group-hover:-translate-x-0.5"
          aria-hidden
        />
        {label}
      </Link>
    </div>
  );
}
