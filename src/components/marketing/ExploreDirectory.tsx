import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type TreeLeaf = {
  href: string;
  label: string;
  detail?: string;
};

export type TreeBranch = {
  href: string;
  label: string;
  hint: string;
  leaves: TreeLeaf[];
};

type GridItem = {
  href: string;
  label: string;
  detail?: string;
};

function flattenTree(branches: TreeBranch[]): GridItem[] {
  return branches.flatMap((branch) => [
    { href: branch.href, label: branch.label, detail: branch.hint },
    ...branch.leaves,
  ]);
}

export function ExploreDirectory({
  navLabel,
  branches,
}: {
  navLabel: string;
  branches: TreeBranch[];
}) {
  const items = flattenTree(branches);
  const oddLast = items.length % 2 === 1;

  return (
    <nav aria-label={navLabel}>
      <ul
        className={cn(
          "explore-stagger grid grid-cols-1 gap-x-10 gap-y-10 sm:grid-cols-2 sm:gap-x-12 sm:gap-y-12",
          oddLast &&
            "[&>li:last-child]:sm:col-span-2 [&>li:last-child]:sm:mx-auto [&>li:last-child]:sm:w-[calc(50%-1.5rem)]"
        )}
      >
        {items.map((item, index) => (
          <li
            key={item.href}
            className="explore-stagger-item min-w-0"
            style={{ "--explore-i": Math.min(index, 11) } as React.CSSProperties}
          >
            <Link
              href={item.href}
              className="group flex h-full min-h-[7.5rem] flex-col justify-between gap-6 rounded-2xl bg-[#f5f5f7] px-7 py-7 outline-offset-4 transition-[transform,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:bg-[#f0ebf8] hover:shadow-[0_10px_28px_-14px_rgba(28,28,30,0.22)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#6d28d9] active:translate-y-0 active:scale-[0.99] sm:min-h-[8.5rem] sm:px-8 sm:py-8"
            >
              <span className="min-w-0">
                <span className="flex items-start justify-between gap-4">
                  <span className="font-[family-name:var(--font-syne)] text-[20px] font-bold leading-snug tracking-tight text-[#1d1d1f] transition-colors duration-200 group-hover:text-[#6d28d9] sm:text-[22px]">
                    {item.label}
                  </span>
                  <ArrowRight
                    className="mt-1 size-4 shrink-0 text-[#6d28d9] transition-transform duration-200 ease-out group-hover:translate-x-1"
                    aria-hidden
                  />
                </span>
                {item.detail ? (
                  <span className="mt-3 block text-[14.5px] leading-[1.6] text-[#1d1d1f]/55 line-clamp-2">
                    {item.detail}
                  </span>
                ) : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
