export function MakeItCropMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="9" fill="#D8FF3C" />
      <rect x="9.5" y="5.75" width="4.4" height="2.15" rx="1.05" fill="#111111" />
      <rect x="9.5" y="5.75" width="2.15" height="5.2" rx="1.05" fill="#111111" />
      <rect x="18.1" y="5.75" width="4.4" height="2.15" rx="1.05" fill="#111111" />
      <rect x="20.35" y="5.75" width="2.15" height="5.2" rx="1.05" fill="#111111" />
      <rect x="9.5" y="24.1" width="4.4" height="2.15" rx="1.05" fill="#111111" />
      <rect x="9.5" y="21.05" width="2.15" height="5.2" rx="1.05" fill="#111111" />
      <rect x="18.1" y="24.1" width="4.4" height="2.15" rx="1.05" fill="#111111" />
      <rect x="20.35" y="21.05" width="2.15" height="5.2" rx="1.05" fill="#111111" />
      <rect x="14.15" y="10.2" width="3.7" height="11.6" rx="1.45" fill="#111111" />
    </svg>
  );
}

export function MakeItCropWordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-semibold tracking-[-0.055em] ${className}`}>MakeItCrop</span>
  );
}

export function MakeItCropLogo({
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
      <MakeItCropMark className={markClassName} />
      <MakeItCropWordmark className={wordClassName} />
    </span>
  );
}
