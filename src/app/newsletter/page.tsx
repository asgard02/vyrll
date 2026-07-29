import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";

export const metadata: Metadata = {
  title: "Newsletter — Ce qui a changé | Upcut",
  description:
    "File multi-serveurs, jobs qui ne disparaissent plus, facturation Stripe, UI plus stable. Le détail de tout ce qu’Upcut a shippé fin juillet 2026.",
  openGraph: {
    title: "Newsletter Upcut — Fiabilité & scale",
    description:
      "Ce qui a changé sous le capot : file partagée, sync des jobs, billing Stripe, et pourquoi tes clips n’apparaissent plus en erreur à tort.",
    url: "https://upcut.app/newsletter",
    siteName: "Upcut",
  },
};

const ISSUE = {
  label: "Édition #1",
  date: "29 juillet 2026",
  title: "Fiabilité, file d’attente & clips qui restent",
  lead:
    "Fin juillet, on a reconstruit le cœur du pipeline clips. Moins de jobs fantômes, plus de capacité, une facturation plus juste — et une UI qui ne clignote plus pour rien.",
};

type Block = {
  kicker: string;
  title: string;
  body: string[];
  bullets?: string[];
  outcome?: string;
};

const BLOCKS: Block[] = [
  {
    kicker: "01 — Scale",
    title: "Plusieurs machines, une seule file",
    body: [
      "Avant, chaque serveur Upcut gardait les jobs clips dans sa propre mémoire. Un redémarrage, un second serveur, et le job pouvait « disparaître » : l’interface affiché une erreur alors que le travail n’était peut‑être pas perdu — juste invisible.",
      "On a basculé sur une file partagée dans Supabase. Tous les workers Railway piochent le prochain job dans le même ordre (FIFO), un à la fois par machine. Résultat : on peut monter à plusieurs replicas (environ six en prod) sans se marcher dessus.",
    ],
    bullets: [
      "1 job complet par replica (download + Whisper + rendu) pour ne pas faire exploser ffmpeg",
      "Jusqu’à 3 clips par vidéo en production",
      "Estimation de place dans la file côté interface",
    ],
    outcome: "La file se vide, même quand beaucoup de créateurs lancent des jobs en même temps.",
  },
  {
    kicker: "02 — Bug critique",
    title: "Les clips « terminés » qui apparaissaient en erreur",
    body: [
      "Le symptôme le plus pénible : le worker avait bel et bien fini (clips uploadés), mais ton projet affichait STALE_JOB_TIMEOUT — zéro clip visible.",
      "Un nettoyeur automatique (reaper) croyait que le job était mort parce qu’il attendait trop longtemps dans la file. Dès que le backend passait à « done », le reaper marquait encore l’UI en erreur… sans recopier les clips.",
    ],
    bullets: [
      "Dès qu’un job finit côté worker, on synchronise immédiatement la fiche projet",
      "Si le backend est done avec des clips, on promote — on ne STALE jamais",
      "Un trigger Postgres garantit le miroir même si un worker crash pile au mauvais moment",
      "L’API projet soigne aussi les anciens faux STALE au prochain chargement",
    ],
    outcome: "On a restauré une quinzaine de projets zombies en prod. Depuis : 0 nouveau cas STALE de ce type.",
  },
  {
    kicker: "03 — Race technique",
    title: "Done à l’écran, « 80 % » côté serveur",
    body: [
      "Autre fantôme : l’UI montrait tes clips (done), pendant que le serveur repassait à « processing » bloqué à 80 %.",
      "Cause : une course. Le dernier update de progression (80 % = tous les clips rendus) partait en parallèle et pouvait écraser le statut « done » écrit une fraction de seconde plus tard — en vidant au passage la liste des clips côté base.",
    ],
    bullets: [
      "Les écritures d’état sont maintenant sérialisées par job",
      "Interdiction de downgrader un job terminé vers « en cours »",
      "setDone attend bien la persistance avant de lâcher la main",
      "Trigger SQL : même attaque simulée en prod → le done tient",
    ],
    outcome: "Plus de projets « done » qui repartent magiquement à 80 %.",
  },
  {
    kicker: "04 — File longue",
    title: "Ne plus tuer les jobs qui attendent tranquillement",
    body: [
      "Avec une vraie file, attendre 40 minutes avant d’être pris en charge peut être normal (beaucoup de monde, jobs longs).",
      "L’ancien reaper se basait seulement sur la date de création : il tuait des jobs encore pending. On a aussi corrigé un reclaim trop agressif (25 min sur claimed_at) qui volait des jobs Whisper/ffmpeg encore vivants.",
    ],
    bullets: [
      "On ne touche pas aux jobs dont le backend est encore pending ou processing",
      "Reclaim uniquement si plus de heartbeat (updated_at) depuis 40 minutes",
    ],
    outcome: "Attendre dans la file ≠ erreur. Seuls les vrais zombies (worker mort) sont recyclés.",
  },
  {
    kicker: "05 — Interface",
    title: "Moins de flicker pendant le polling",
    body: [
      "Quand le backend mettait trop longtemps à répondre, l’UI passait parfois en erreur puis revenait — un flash désagréable sur la page projet.",
      "Désormais, un timeout de poll est un soft-fail : on garde le dernier statut connu Supabase au lieu de faire croire que le job a planté.",
    ],
    outcome: "La page projet respire : plus de yo-yo loading → erreur → loading.",
  },
  {
    kicker: "06 — Argent",
    title: "Stripe + crédits qui ne double-comptent pas",
    body: [
      "Le checkout Creator / Studio passe par Stripe (plus Lemon Squeezy sur le parcours principal).",
      "La facturation des minutes de clips est retry-safe : même si tu recharges la page pile au moment où le job passe à done, on ne te re-débitera pas — la RPC charge_clip_job_once ne facture qu’une fois.",
    ],
    outcome: "Upgrade clair vers /plans, crédits cohérents même en cas de retry réseau.",
  },
  {
    kicker: "07 — Qualité clips",
    title: "Whisper, uploads, split & rendu",
    body: [
      "Dans le même sprint : découpage Whisper plus robuste, hooks plus propres sur les uploads, moins de faux positifs split vertical sur les monologues, et un réglage ffmpeg pour éviter les OOM / BrokenPipe sur Railway Hobby.",
      "Les uploads peuvent aussi court-circuiter la détection de « moments viraux » quand tu sais déjà ce que tu veux couper — moins d’attente inutile.",
    ],
    outcome: "Moins d’échecs silencieux au rendu, meilleurs découpages sur podcasts et longs formats.",
  },
];

const TIMELINE = [
  { d: "28/07", t: "File partagée multi-replicas + capacité ×6" },
  { d: "28/07", t: "Billing crédits idempotent + Stripe au premier plan" },
  { d: "29/07", t: "Reaper STALE corrigé — plus de jobs morts à tort" },
  { d: "29/07", t: "Poll UI soft-fail — plus de flicker" },
  { d: "29/07", t: "Sync forcée done → projet + heal des zombies" },
  { d: "29/07", t: "Race 80 % neutralisée (code + trigger SQL)" },
];

export default function NewsletterPage() {
  return (
    <div className="nl-root min-h-screen text-[#12141a]">
      <style>{`
        .nl-root {
          --nl-ink: #12141a;
          --nl-muted: #5c6370;
          --nl-line: rgba(18, 20, 26, 0.1);
          --nl-accent: #0d9488;
          --nl-accent-soft: #ccfbf1;
          --nl-warm: #fff7ed;
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
      `}</style>

      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 pb-2 pt-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2 font-[family-name:var(--font-syne)] text-lg font-bold tracking-tight text-[var(--nl-ink)]"
        >
          <img src="/logo.svg" alt="" className="size-7" />
          Upcut
        </Link>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-[var(--nl-muted)] transition-colors hover:text-[var(--nl-ink)]"
        >
          <ArrowLeft className="size-3.5" />
          Accueil
        </Link>
      </header>

      <main className="mx-auto max-w-3xl px-6 pb-24 pt-10">
        <p className="nl-fade font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--nl-accent)]">
          {ISSUE.label} · {ISSUE.date}
        </p>

        <h1 className="nl-fade nl-fade-d1 mt-4 font-[family-name:var(--font-syne)] text-[clamp(2rem,5vw,3.25rem)] font-extrabold leading-[1.08] tracking-[-0.03em]">
          {ISSUE.title}
        </h1>

        <p className="nl-fade nl-fade-d2 mt-5 max-w-2xl text-[clamp(1.05rem,2vw,1.2rem)] leading-relaxed text-[var(--nl-muted)]">
          {ISSUE.lead}
        </p>

        <div className="nl-fade nl-fade-d3 mt-10 rounded-2xl border border-[var(--nl-line)] bg-white/70 p-6 backdrop-blur-sm sm:p-8">
          <p className="font-[family-name:var(--font-syne)] text-sm font-bold uppercase tracking-[0.12em] text-[var(--nl-ink)]">
            En une phrase
          </p>
          <p className="mt-3 text-[1.05rem] leading-relaxed text-[var(--nl-ink)]">
            Upcut peut maintenant enchaîner beaucoup plus de générations en parallèle{" "}
            <em>sans</em> perdre tes clips à la fin — ni les marquer en erreur alors qu’ils
            sont prêts.
          </p>
        </div>

        <ol className="mt-16 space-y-16">
          {BLOCKS.map((b, i) => (
            <li key={b.kicker} className="nl-fade" style={{ animationDelay: `${0.05 * i}s` }}>
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--nl-accent)]">
                {b.kicker}
              </p>
              <h2 className="mt-2 font-[family-name:var(--font-syne)] text-[1.65rem] font-bold tracking-[-0.02em] text-[var(--nl-ink)]">
                {b.title}
              </h2>
              <div className="mt-4 space-y-3 text-[1.02rem] leading-relaxed text-[var(--nl-muted)]">
                {b.body.map((p) => (
                  <p key={p.slice(0, 40)}>{p}</p>
                ))}
              </div>
              {b.bullets && (
                <ul className="mt-5 space-y-2 border-l-2 border-[var(--nl-accent)]/40 pl-4 text-[0.98rem] leading-relaxed text-[var(--nl-ink)]/85">
                  {b.bullets.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
              {b.outcome && (
                <p className="mt-5 rounded-xl bg-[var(--nl-accent-soft)]/70 px-4 py-3 text-sm font-medium leading-relaxed text-[#0f766e]">
                  → {b.outcome}
                </p>
              )}
            </li>
          ))}
        </ol>

        <section className="mt-20 border-t border-[var(--nl-line)] pt-12">
          <h2 className="font-[family-name:var(--font-syne)] text-2xl font-bold tracking-tight">
            Chronologie express
          </h2>
          <ul className="mt-6 space-y-0">
            {TIMELINE.map((row) => (
              <li
                key={row.t}
                className="grid grid-cols-[4.5rem_1fr] gap-4 border-b border-[var(--nl-line)] py-3.5 text-sm sm:grid-cols-[5.5rem_1fr] sm:text-base"
              >
                <span className="font-mono text-[var(--nl-accent)]">{row.d}</span>
                <span className="text-[var(--nl-ink)]/90">{row.t}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-16 rounded-2xl border border-[var(--nl-line)] bg-[var(--nl-ink)] px-6 py-10 text-[#f7f4ef] sm:px-10">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-teal-300">
            Pour les curieux
          </p>
          <h2 className="mt-3 font-[family-name:var(--font-syne)] text-2xl font-bold tracking-tight">
            Sous le capot, sans jargon inutile
          </h2>
          <div className="mt-5 space-y-3 text-[0.98rem] leading-relaxed text-white/75">
            <p>
              Tables clés : <code className="text-teal-200">clip_jobs</code> (ce que tu vois)
              et <code className="text-teal-200">clip_backend_jobs</code> (ce que les workers
              exécutent). Elles doivent rester alignées.
            </p>
            <p>
              Claim SQL FIFO avec <code className="text-teal-200">FOR UPDATE SKIP LOCKED</code>,
              heartbeats sur <code className="text-teal-200">updated_at</code>, triggers Postgres
              pour le miroir <code className="text-teal-200">done</code> et l’interdiction de
              downgrade.
            </p>
            <p>
              Détail technique interne :{" "}
              <code className="text-teal-200">docs/MODIFS_28-29_JUILLET_2026.md</code> dans le
              repo.
            </p>
          </div>
        </section>

        <section className="mt-16 text-center">
          <p className="font-[family-name:var(--font-syne)] text-2xl font-bold tracking-tight text-[var(--nl-ink)]">
            Prêt à générer ?
          </p>
          <p className="mx-auto mt-2 max-w-md text-[var(--nl-muted)]">
            Colle un lien YouTube ou Twitch — la file est plus solide qu’hier.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-full bg-[var(--nl-ink)] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-black"
            >
              Ouvrir le dashboard
              <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/plans"
              className="inline-flex items-center gap-2 rounded-full border border-[var(--nl-line)] bg-white/80 px-5 py-2.5 text-sm font-semibold text-[var(--nl-ink)] transition hover:bg-white"
            >
              Voir les plans
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--nl-line)] px-6 py-8 text-center text-sm text-[var(--nl-muted)]">
        <p>
          <span className="font-[family-name:var(--font-syne)] font-bold text-[var(--nl-ink)]">
            Upcut
          </span>{" "}
          · Newsletter · {ISSUE.date}
        </p>
        <p className="mt-2">
          <Link href="/" className="underline-offset-2 hover:underline">
            upcut.app
          </Link>
        </p>
      </footer>
    </div>
  );
}
