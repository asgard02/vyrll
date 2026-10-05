const PIECES = [
  { name: "tl", origin: "16.8% 17.4%" },
  { name: "tr", origin: "82.4% 17.4%" },
  { name: "br", origin: "82.2% 82.8%" },
  { name: "bl", origin: "16.8% 82.6%" },
  { name: "c", origin: "49.2% 50.3%" },
] as const;

const CSS = `
.lc-load-piece { animation: var(--lc-anim) 1.7s linear infinite; }
.lc-load-tl { --lc-anim: lc-load-tl; }
.lc-load-tr { --lc-anim: lc-load-tr; }
.lc-load-br { --lc-anim: lc-load-br; }
.lc-load-bl { --lc-anim: lc-load-bl; }
.lc-load-c { --lc-anim: lc-load-c; }
@keyframes lc-load-tl {
  0%, 2% { transform: translate(-48%, -48%) scale(0.25) rotate(-32deg); opacity: 0; filter: brightness(1); }
  14% { transform: translate(3%, 3%) scale(1.14) rotate(8deg); opacity: 1; filter: brightness(1.7); }
  20%, 64% { transform: none; opacity: 1; filter: brightness(1); }
  80%, 100% { transform: translate(-48%, -48%) scale(0.25) rotate(-32deg); opacity: 0; filter: brightness(1); }
}
@keyframes lc-load-tr {
  0%, 12% { transform: translate(48%, -48%) scale(0.25) rotate(32deg); opacity: 0; filter: brightness(1); }
  24% { transform: translate(-3%, 3%) scale(1.14) rotate(-8deg); opacity: 1; filter: brightness(1.7); }
  30%, 64% { transform: none; opacity: 1; filter: brightness(1); }
  80%, 100% { transform: translate(48%, -48%) scale(0.25) rotate(32deg); opacity: 0; filter: brightness(1); }
}
@keyframes lc-load-br {
  0%, 22% { transform: translate(48%, 48%) scale(0.25) rotate(-32deg); opacity: 0; filter: brightness(1); }
  34% { transform: translate(-3%, -3%) scale(1.14) rotate(8deg); opacity: 1; filter: brightness(1.7); }
  40%, 64% { transform: none; opacity: 1; filter: brightness(1); }
  80%, 100% { transform: translate(48%, 48%) scale(0.25) rotate(-32deg); opacity: 0; filter: brightness(1); }
}
@keyframes lc-load-bl {
  0%, 32% { transform: translate(-48%, 48%) scale(0.25) rotate(32deg); opacity: 0; filter: brightness(1); }
  44% { transform: translate(3%, -3%) scale(1.14) rotate(-8deg); opacity: 1; filter: brightness(1.7); }
  50%, 64% { transform: none; opacity: 1; filter: brightness(1); }
  80%, 100% { transform: translate(-48%, 48%) scale(0.25) rotate(32deg); opacity: 0; filter: brightness(1); }
}
@keyframes lc-load-c {
  0%, 42% { transform: scale(0); opacity: 0; filter: brightness(1); }
  50% { transform: scale(1.28); opacity: 1; filter: brightness(2); }
  56% { transform: scale(0.94); opacity: 1; filter: brightness(1.15); }
  60%, 64% { transform: scale(1); opacity: 1; filter: brightness(1); }
  72% { transform: scale(1.16); opacity: 1; filter: brightness(1.5); }
  80%, 100% { transform: scale(0); opacity: 0; filter: brightness(1); }
}
@media (prefers-reduced-motion: reduce) {
  .lc-load-piece { animation: none; opacity: 1; transform: none; filter: none; }
}
`;

export function LinkerClipLoader({ className = "w-44" }: { className?: string }) {
  return (
    <div className={`relative aspect-[512/501] ${className}`} role="img" aria-label="Trimoai">
      <style>{CSS}</style>
      {PIECES.map((piece) => (
        <img
          key={piece.name}
          src={`/linkerclip-loader/${piece.name}.png`}
          alt=""
          className={`lc-load-piece lc-load-${piece.name} absolute inset-0 size-full`}
          style={{ transformOrigin: piece.origin }}
        />
      ))}
    </div>
  );
}
