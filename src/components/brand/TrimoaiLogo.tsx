export function TrimoaiMark({
  className = "size-7",
  alt = "",
}: {
  className?: string;
  alt?: string;
}) {
  return (
    <svg
      viewBox="0 0 412 312"
      className={`shrink-0 fill-current ${className}`}
      role={alt ? "img" : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
    >
      <path d="M0 0H272L248 42H148V244L114 312H106V42H0Z" />
      <path d="M260 70H288L410 312H362L274 140L186 312H138Z" />
    </svg>
  );
}

export function TrimoaiLogo({
  className = "",
  markClassName = "size-7",
  wordClassName = "text-[15px]",
  word = "TrimoAI",
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
