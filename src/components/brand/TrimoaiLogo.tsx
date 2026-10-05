export function TrimoaiMark({
  className = "size-7",
  alt = "",
}: {
  className?: string;
  alt?: string;
}) {
  return (
    <span
      className={`inline-grid shrink-0 place-items-center overflow-hidden rounded-[22%] bg-black ${className}`}
    >
      <img src="/trimoai-mark.png" alt={alt} className="size-[86%] object-contain" />
    </span>
  );
}

export function TrimoaiLogo({
  className = "",
  markClassName = "size-7",
  wordClassName = "text-[15px]",
  word = "Trimoai",
}: {
  className?: string;
  markClassName?: string;
  wordClassName?: string;
  word?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2 text-current ${className}`}>
      <TrimoaiMark className={markClassName} />
      <span className={`font-medium tracking-[-0.03em] ${wordClassName}`}>{word}</span>
    </span>
  );
}
