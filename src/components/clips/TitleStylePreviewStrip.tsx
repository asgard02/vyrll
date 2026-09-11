"use client";

import type { TitleStyleId } from "@/lib/title-styles";

const SAMPLE = "What if AI";

type Props = {
  styleId: TitleStyleId;
  size?: "sm" | "lg";
};

export function TitleStylePreviewStrip({ styleId, size = "lg" }: Props) {
  const lg = size === "lg";

  if (styleId === "magazine") {
    return (
      <p className={`text-center leading-tight text-white ${lg ? "text-[15px]" : "text-[11px]"}`}>
        What if <span className="font-serif italic">AI</span>
      </p>
    );
  }

  if (styleId === "stroke") {
    return (
      <p
        className={`text-center font-black leading-none text-white ${lg ? "text-[16px]" : "text-[12px]"}`}
        style={{
          textShadow: "-1.5px -1.5px 0 #000, 1.5px -1.5px 0 #000, -1.5px 1.5px 0 #000, 1.5px 1.5px 0 #000",
        }}
      >
        {SAMPLE}
      </p>
    );
  }

  if (styleId === "kicker") {
    return (
      <div className="px-0.5">
        <div className={`mb-1.5 h-px bg-white/85 ${lg ? "w-10" : "w-8"}`} />
        <p
          className={`text-left leading-tight text-white ${lg ? "text-[15px]" : "text-[12px]"}`}
          style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
        >
          {SAMPLE}
        </p>
      </div>
    );
  }

  if (styleId === "marker") {
    return (
      <p className={`text-center leading-tight text-white ${lg ? "text-[14px]" : "text-[11px]"}`}>
        What if{" "}
        <span className="rounded-sm bg-[#ffe046] px-1 font-medium text-[#141210]">AI</span>
      </p>
    );
  }

  if (styleId === "tape") {
    return (
      <div className="flex justify-center">
        <span
          className={`rounded-md bg-[#f5eedc] font-medium text-[#1c1814] ${
            lg ? "px-2.5 py-1.5 text-[12px]" : "px-2 py-1 text-[10px]"
          }`}
          style={{ transform: "rotate(-2deg)" }}
        >
          {SAMPLE}
        </span>
      </div>
    );
  }

  return (
    <div className="flex justify-center">
      <span
        className={`rounded-xl bg-white font-black leading-none text-black ${
            lg ? "px-3 py-1.5 text-[12px]" : "px-2 py-1 text-[10px]"
          }`}
      >
        {SAMPLE}
      </span>
    </div>
  );
}
