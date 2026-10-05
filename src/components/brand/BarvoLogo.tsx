export function BarvoMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="9" fill="#D8FF3C" />
      <rect x="7" y="6.5" width="5.4" height="19" rx="1.7" fill="#111111" />
      <path
        d="M15.15 7.2C15.15 6.52 15.88 6.08 16.49 6.4L25.1 10.9C25.74 11.24 25.74 12.16 25.1 12.5L16.49 17C15.88 17.32 15.15 16.88 15.15 16.2V7.2Z"
        fill="#111111"
      />
      <path
        d="M15.15 15.8C15.15 15.12 15.88 14.68 16.49 15L25.1 19.5C25.74 19.84 25.74 20.76 25.1 21.1L16.49 25.6C15.88 25.92 15.15 25.48 15.15 24.8V15.8Z"
        fill="#111111"
      />
    </svg>
  );
}

export function BarvoWordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-semibold tracking-[-0.04em] ${className}`}>barvo</span>
  );
}

export function BarvoLogo({
  className = "",
  markClassName = "size-7",
  wordClassName = "text-[17px] text-[#f3f0e8]",
}: {
  className?: string;
  markClassName?: string;
  wordClassName?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <BarvoMark className={markClassName} />
      <BarvoWordmark className={wordClassName} />
    </span>
  );
}
