"use client";

export function AnalyseLoading({
  label,
  subtitle,
}: {
  label: string;
  subtitle?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-6">
      <div className="flex items-end justify-center gap-1.5 h-8">
        {[1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            className="animate-analyse-bar w-2 rounded-full bg-[#00ff88] h-6 block"
            style={{
              boxShadow: "0 0 12px rgba(0, 255, 136, 0.4)",
            }}
          />
        ))}
      </div>
      <p className="font-mono text-sm text-zinc-400">{label}</p>
      {subtitle && (
        <p className="font-mono text-xs text-zinc-600 text-center max-w-xs">
          {subtitle}
        </p>
      )}
    </div>
  );
}
