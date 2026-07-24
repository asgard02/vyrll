import { ArrowRight, Download, Link2, RefreshCw, Sparkles, type LucideIcon } from "lucide-react";
import { SiInstagram, SiTiktok, SiYoutube } from "react-icons/si";
import { HeroUrlForm } from "@/components/landing/HeroClient";

const STEP_ICONS: LucideIcon[] = [Link2, Sparkles, Download];

type Step = { title: string; desc: string };

/**
 * Safari notes:
 * - Do NOT use data-animate / Tailwind animate-in here: single-keyframe
 *   `enter` + fill-mode none often leaves opacity/transform stuck on WebKit.
 * - Prefer explicit px sizes over aspect-ratio + absolute-only children.
 * - Prefer negative margins over transform stacks for the phone fan.
 */

function ImportVisual() {
  return (
    <div
      style={{
        width: 200,
        maxWidth: "100%",
        borderRadius: 16,
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.1)",
        background: "#1a1a1c",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/yt-bunker-thumb.jpg"
        alt=""
        width={200}
        height={112}
        decoding="async"
        style={{ display: "block", width: "100%", height: 112, objectFit: "cover" }}
      />
    </div>
  );
}

function EditVisual() {
  const posters = [
    { src: "/hero-clip-1-poster.jpg", w: 56, h: 100, z: 1 },
    { src: "/demo-poster.jpg", w: 68, h: 120, z: 3 },
    { src: "/hero-clip-2-poster.jpg", w: 56, h: 100, z: 1 },
  ];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        height: 140,
        width: "100%",
        maxWidth: 200,
      }}
    >
      {posters.map((p, i) => (
        <div
          key={p.src}
          style={{
            position: "relative",
            width: p.w,
            height: p.h,
            marginLeft: i === 0 ? 0 : -18,
            zIndex: p.z,
            flexShrink: 0,
            overflow: "hidden",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.15)",
            background: "#1a1a1c",
            boxShadow: "0 12px 28px -16px rgba(0,0,0,0.9)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={p.src}
            alt=""
            width={p.w}
            height={p.h}
            decoding="async"
            style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }}
          />
        </div>
      ))}
    </div>
  );
}

function ExportVisual() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        flexWrap: "nowrap",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        height: 140,
        width: "100%",
        maxWidth: 220,
      }}
    >
      <div
        style={{
          width: 64,
          height: 114,
          flexShrink: 0,
          overflow: "hidden",
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.15)",
          background: "#1a1a1c",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/demo-poster.jpg"
          alt=""
          width={64}
          height={114}
          decoding="async"
          style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {[SiTiktok, SiYoutube, SiInstagram].map((Icon, i) => (
          <span
            key={i}
            style={{
              display: "flex",
              width: 28,
              height: 28,
              flexShrink: 0,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(255,255,255,0.08)",
              color: "rgba(255,255,255,0.8)",
            }}
          >
            <Icon style={{ width: 14, height: 14 }} />
          </span>
        ))}
      </div>
    </div>
  );
}

function StepVisual({ index }: { index: number }) {
  if (index === 0) return <ImportVisual />;
  if (index === 1) return <EditVisual />;
  return <ExportVisual />;
}

export function WorkflowSection({
  eyebrow,
  title,
  subtitle,
  items,
  ctaPlaceholder,
  ctaButton,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  items: Step[];
  ctaPlaceholder: string;
  ctaButton: string;
}) {
  return (
    <section id="comment-ca-marche" className="scroll-mt-24 px-4 py-10 sm:px-6">
      <div id="fonctionnalites" className="mx-auto max-w-[1100px] scroll-mt-24">
        <div className="mb-12 text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-[#7c3aed]/15 bg-[#f4f0ff] px-3.5 py-1.5 font-mono text-[10.5px] font-bold uppercase tracking-[0.16em] text-[#5b21b6]">
            <RefreshCw className="h-3 w-3" aria-hidden />
            {eyebrow}
          </span>
          <h2 className="mx-auto mt-5 max-w-2xl font-[family-name:var(--font-syne)] text-[clamp(26px,3.4vw,40px)] font-bold leading-tight tracking-[-0.02em] text-[#1d1d1f]">
            {title}
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-[15px] leading-relaxed text-[#1d1d1f]/60">{subtitle}</p>
        </div>

        <div className="relative overflow-hidden rounded-[32px] bg-[#141416] px-5 pb-8 pt-10 sm:px-8 sm:pb-10 sm:pt-12 lg:px-10">
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              opacity: 0.4,
              background:
                "radial-gradient(ellipse 70% 50% at 50% 0%, rgba(124,58,237,0.18), transparent 60%)",
            }}
            aria-hidden
          />

          <div className="relative flex flex-col gap-10 sm:flex-row sm:items-start sm:gap-0">
            {items.flatMap((step, i) => {
              const Icon = STEP_ICONS[i];
              const stepNode = (
                <div key={step.title} className="flex min-w-0 flex-1 flex-col items-center text-center">
                  <div className="mb-7 flex h-[140px] w-full items-center justify-center overflow-hidden">
                    <StepVisual index={i} />
                  </div>
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 shrink-0 text-[#a78bfa]" aria-hidden />
                    <h3 className="font-[family-name:var(--font-syne)] text-[17px] font-bold text-white">
                      {step.title}
                    </h3>
                  </div>
                  <p className="mt-2 max-w-[260px] text-[13.5px] leading-relaxed text-white/55">
                    {step.desc}
                  </p>
                </div>
              );
              if (i === 0) return [stepNode];
              return [
                <div
                  key={`arrow-${i}`}
                  className="hidden shrink-0 items-center justify-center pt-[60px] sm:flex"
                  style={{ width: 36 }}
                  aria-hidden
                >
                  <ArrowRight className="h-5 w-5 text-white/25" strokeWidth={1.75} />
                </div>,
                stepNode,
              ];
            })}
          </div>

          <div className="relative mx-auto mt-10 max-w-[480px] sm:mt-12">
            <HeroUrlForm
              variant="dark"
              size="default"
              className="mx-auto"
              placeholderOverride={ctaPlaceholder}
              buttonLabelOverride={ctaButton}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
