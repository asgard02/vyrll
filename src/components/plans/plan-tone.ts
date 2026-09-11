export type PlansContentVariant = "marketing" | "app" | "cut";

export function planTone(variant: PlansContentVariant) {
  const cut = variant === "cut";
  const app = variant === "app";

  return {
    cut,
    app,
    ink: cut ? "text-[#fdfff0]" : app ? "text-foreground" : "text-[#1d1d1f]",
    muted: cut ? "text-[#fdfff0]/45" : app ? "text-muted-foreground" : "text-[#1d1d1f]/55",
    mutedSoft: cut ? "text-[#fdfff0]/35" : app ? "text-muted-foreground" : "text-[#1d1d1f]/50",
    hairline: cut ? "border-[#212121]" : app ? "border-border" : "border-[#e5e5e7]",
    offer: cut
      ? "text-[#fdfff0]"
      : app
        ? "text-primary"
        : "text-[#100e0e]",
    badge: cut
      ? "bg-[#fdfff0] text-[#100e0e]"
      : app
        ? "bg-primary text-primary-foreground"
        : "bg-[#100e0e] text-[#fdfff0]",
    badgeSoft: cut
      ? "bg-[#fdfff0]/10 text-[#fdfff0] ring-1 ring-[#fdfff0]/20"
      : app
        ? "bg-primary/10 text-primary ring-1 ring-primary/25"
        : "bg-[#f4f4f0] text-[#100e0e] ring-1 ring-[#100e0e]/20",
    checkOnBg: cut
      ? "bg-[#fdfff0]/15"
      : app
        ? "bg-primary/15"
        : "bg-[#100e0e]/15",
    checkOn: cut ? "text-[#fdfff0]" : app ? "text-primary" : "text-[#100e0e]",
    checkOffBg: cut ? "bg-[#fdfff0]/8" : app ? "bg-muted" : "bg-[#f5f5f7]",
    checkOff: cut
      ? "text-[#fdfff0]/45"
      : app
        ? "text-muted-foreground"
        : "text-[#1d1d1f]/45",
    pill: cut
      ? "border-[#212121] bg-[#181616]"
      : app
        ? "border-border bg-muted/60"
        : "border-[#e5e5e7] bg-[#f5f5f7]",
    pillSelected: cut
      ? "bg-[#fdfff0] text-[#100e0e] shadow-none"
      : app
        ? "bg-background text-foreground shadow-sm"
        : "bg-white text-[#1d1d1f] shadow-sm",
    pillIdle: cut
      ? "text-[#fdfff0]/80 hover:text-[#fdfff0]"
      : app
        ? "text-muted-foreground hover:text-foreground"
        : "text-[#1d1d1f]/55 hover:text-[#1d1d1f]",
    tableCreatorHead: cut
      ? "bg-[#fdfff0]/8 text-[#fdfff0]"
      : app
        ? "bg-primary/8 text-primary"
        : "bg-[#f4f4f0] text-[#100e0e]",
    tableCreatorCell: cut
      ? "bg-[#fdfff0]/4"
      : app
        ? "bg-primary/5"
        : "bg-[#f4f4f0]/70",
    tableRow: cut
      ? "border-[#212121]/80 hover:bg-[#fdfff0]/4"
      : app
        ? "border-border/70 hover:bg-muted/40"
        : "border-[#e5e5e7]/70 hover:bg-[#f5f5f7]/50",
    heroBadge: cut
      ? "border-[#fdfff0]/20 bg-[#fdfff0]/8 text-[#fdfff0]"
      : app
        ? "border-primary/20 bg-primary/10 text-primary"
        : "border-[#100e0e]/20 bg-[#f4f4f0] text-[#100e0e]",
    ctaAccent:
      "bg-[#fdfff0] text-[#100e0e] hover:bg-[#e8eadc] active:scale-[0.99]",
    ctaStudio: cut
      ? "border border-[#fdfff0]/25 bg-[#fdfff0]/8 text-[#fdfff0] hover:bg-[#fdfff0]/12"
      : app
        ? "border border-primary/30 bg-primary/10 text-primary hover:bg-primary/15"
        : "border border-[#100e0e]/30 bg-[#f4f4f0] text-[#100e0e] hover:bg-[#ecece6]",
    ctaIdle: cut
      ? "border border-[#2a2a2a] bg-transparent text-[#fdfff0] hover:border-[#fdfff0]/25"
      : app
        ? "border border-border bg-muted text-foreground hover:border-input"
        : "border border-[#e5e5e7] bg-[#f5f5f7] text-[#1d1d1f] hover:border-[#1d1d1f]/20",
    ctaMarketing:
      "bg-[#100e0e] text-[#fdfff0] hover:bg-[#181616] active:scale-[0.99]",
  };
}

export function planCardClass(
  variant: PlansContentVariant,
  accent: boolean,
  studio: boolean
) {
  const t = planTone(variant);
  const base = "relative flex flex-col overflow-hidden rounded-2xl border transition-shadow";
  if (t.cut) {
    if (accent) return `${base} border-[#fdfff0]/25 bg-[#181616]`;
    if (studio) return `${base} border-[#fdfff0]/15 bg-[#181616] hover:border-[#fdfff0]/30`;
    return `${base} border-[#212121] bg-[#181616] hover:border-[#2a2a2a]`;
  }
  if (t.app) {
    if (accent)
      return `${base} border-primary/40 bg-card shadow-sm`;
    if (studio)
      return `${base} border-primary/25 bg-card shadow-sm hover:border-primary/40`;
    return `${base} border-border bg-card shadow-sm hover:border-input`;
  }
  if (accent)
    return `${base} border-[#100e0e]/40 bg-white shadow-sm`;
  if (studio)
    return `${base} border-[#100e0e]/25 bg-white shadow-sm hover:shadow-[0_8px_24px_-10px_rgba(16,14,14,0.12)]`;
  return `${base} border-[#e5e5e7] bg-white shadow-[0_1px_2px_-1px_rgba(28,28,30,0.1),0_4px_14px_-6px_rgba(28,28,30,0.08)] hover:shadow-[0_8px_24px_-10px_rgba(28,28,30,0.12)]`;
}
