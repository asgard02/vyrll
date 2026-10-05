export function LinkerClipMark({ className = "size-7" }: { className?: string }) {
  return (
    <img
      src="/trimoai-mark.png"
      alt=""
      className={`object-contain ${className}`}
    />
  );
}

export function LinkerClipLogo({
  className = "",
  markClassName = "size-6",
  wordClassName = "text-[18px]",
}: {
  className?: string;
  markClassName?: string;
  wordClassName?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 text-white ${className}`}>
      <LinkerClipMark className={markClassName} />
      <span className={`font-medium tracking-[-0.02em] ${wordClassName}`}>Trimoai</span>
    </span>
  );
}
