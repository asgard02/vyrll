export const NL_STYLES = `
  .nl-root {
    --nl-ink: var(--lp-ink);
    --nl-muted: var(--lp-ink-80);
    --nl-line: var(--lp-hairline);
    --nl-accent: var(--lp-accent);
    --nl-accent-deep: var(--lp-accent-deep);
    --nl-accent-soft: var(--lp-accent-soft);
    --nl-paper: var(--lp-canvas);
    color: var(--lp-ink);
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
