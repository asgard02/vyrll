export const NL_STYLES = `
  .nl-root {
    --nl-ink: #12141a;
    --nl-muted: #5c6370;
    --nl-line: rgba(18, 20, 26, 0.1);
    --nl-accent: #0d9488;
    --nl-accent-soft: #ccfbf1;
    --nl-paper: #f7f4ef;
    background:
      radial-gradient(1200px 600px at 10% -10%, #ccfbf1 0%, transparent 55%),
      radial-gradient(900px 500px at 100% 0%, #ffedd5 0%, transparent 50%),
      linear-gradient(180deg, #f7f4ef 0%, #f3f0ea 40%, #efebe3 100%);
  }
  .nl-fade { animation: nl-up 0.7s cubic-bezier(0.22, 1, 0.36, 1) both; }
  .nl-fade-d1 { animation-delay: 0.08s; }
  .nl-fade-d2 { animation-delay: 0.16s; }
  .nl-fade-d3 { animation-delay: 0.24s; }
  @keyframes nl-up {
    from { opacity: 0; transform: translateY(18px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .nl-fade, .nl-fade-d1, .nl-fade-d2, .nl-fade-d3 { animation: none; }
  }
`;
