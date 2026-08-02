import type { Metadata } from "next";

export type NewsletterBlock = {
  kicker: string;
  title: string;
  body: string[];
  bullets?: string[];
  outcome?: string;
};

export type NewsletterIssue = {
  slug: string;
  number: number;
  label: string;
  date: string;
  title: string;
  lead: string;
  teaser: string;
  oneLiner?: string;
  blocks: NewsletterBlock[];
  timeline?: { d: string; t: string }[];
  underTheHood?: string[];
};

export const NEWSLETTER_ISSUES: NewsletterIssue[] = [
  {
    slug: "2-cadrage-split-aout",
    number: 2,
    label: "Édition #2",
    date: "2 août 2026",
    title: "Quand le split se trompe — et comment on l’a remis d’aplomb",
    lead:
      "Début août, le chantier n’était plus la file d’attente : c’était le cadrage. Sur les podcasts et les plans à plusieurs têtes, Upcut devait enfin décider proprement quand couper l’écran en deux — sans zoomer sur une épaule, sans rester coincé en mono, sans inventer un split fantôme.",
    teaser:
      "Détection qui marchait en local mais pas en prod, split qui s’armait puis retombait en mono, progression qui mentait. On a repris le pipeline de cadrage à la racine.",
    oneLiner:
      "Upcut sait maintenant reconnaître un vrai plan à deux (ou plus) personnes en production — et basculer split ↔ mono dans le même clip quand le plan change.",
    blocks: [
      {
        kicker: "01 — Le symptôme",
        title: "Ça marchait sur mon Mac. Pas sur les serveurs.",
        body: [
          "Le plus frustrant : la même vidéo, la même fenêtre de temps, un résultat correct en local… et zéro split en production. L’interface montrait un podcast, le worker analysait bien les frames, mais la détection de visages renvoyait du vide — comme si la scène était vide alors que l’image était nette.",
          "On a arrêté d’empiler des seuils « pour voir ». D’abord comprendre où la chaîne cassait : acquisition des images, détection, décision clip, puis rendu. Spoiler : ce n’était pas la durée du clip (15 s ou 90 s, même échec).",
        ],
        outcome:
          "Diagnostiquer avant de patcher. Une fois le vrai étage identifié, le reste du gate redevient lisible.",
      },
      {
        kicker: "02 — Faux amis",
        title: "Split annoncé, mono livré — ou zoom sur le torse",
        body: [
          "Deux autres fantômes se cumulaient. Parfois le système « ouvrait » un split sur des indices trop faibles : le rendu, plus strict, ne trouvait rien et retombait en cadrage classique. Résultat : badge split, vidéo mono.",
          "Pire : quand la détection principale était aveugle, un filet de secours accrochait parfois le mauvais coin du corps. Le mono se mettait à suivre une épaule au lieu d’un visage. Inutilisable — et trompeur, parce que « quelque chose » bougeait encore à l’écran.",
        ],
        bullets: [
          "Aligner la décision « ce clip mérite un split » sur le même test que le rendu frame par frame",
          "Ne plus ouvrir le hybrid sur des paires inventées",
          "Recadrer le mono uniquement sur une vraie tête",
        ],
        outcome:
          "Soit un split réel (et souvent hybride : split puis gros plan dans le même clip), soit un mono propre. Plus de demi-mesures.",
      },
      {
        kicker: "03 — Prod vs atelier",
        title: "Les images étaient là. Les têtes, non.",
        body: [
          "Les logs montraient des frames valides (luminosité normale, extraction fiable) et pourtant zéro visage détecté d’un bout à l’autre du clip. En local, les mêmes fenêtres trouvaient clairement deux personnes autour d’une table.",
          "La cause était côté environnement de production : la pile de détection ne se comportait pas comme sur une machine de dev. Une fois le runtime et le chemin d’analyse remis d’accord avec ce qu’on validait en atelier, les compteurs sont remontés — et les podcasts Elon / Economist sont repartis en split sur toute la ligne.",
        ],
        outcome:
          "Ce qui est vrai en local doit être vrai en prod. Sinon on optimise un fantôme.",
      },
      {
        kicker: "04 — Progression",
        title: "La barre qui redescendait à 0 %",
        body: [
          "Petit cousin du chantier juillet : avec plusieurs machines derrière le même load balancer, un poll pouvait retomber sur une réplique qui n’avait qu’une copie « fantôme » du job à 0 %, alors qu’ailleurs le vrai worker avançait.",
          "On a nettoyé ce décalage pour que la progression affichée ne recule plus. Moins de stress inutile pendant une génération longue.",
        ],
        outcome: "La barre monte — ou stagne. Elle ne rejoue plus le film à l’envers.",
      },
      {
        kicker: "05 — Ce que ça donne",
        title: "Podcasts, et même les plans à trois",
        body: [
          "Sur un long format interview, le split s’arme quand le plan le mérite, avec un mélange split / mono dans le même clip quand la caméra change — c’est voulu, pas un bug.",
          "Sur une vidéo non-podcast avec plusieurs personnes un peu serrées, le hybrid peut aussi ouvrir : tu vois tout le monde, les réactions, puis un retour en gros plan. Pas toujours « académique », mais souvent plus utile qu’un crop qui choisit la mauvaise tête.",
        ],
        outcome:
          "Le cadrage suit la scène. Il ne force plus un mode unique du début à la fin.",
      },
    ],
    timeline: [
      { d: "01/08", t: "File & cadrage : fin des jobs qui se marchent dessus en multi-user" },
      { d: "02/08", t: "Seek d’analyse fiable — plus de samples « solo » inventés" },
      { d: "02/08", t: "Détection visages rétablie en production" },
      { d: "02/08", t: "Gate et rendu alignés sur le même critère « plan propice »" },
      { d: "02/08", t: "Mono recentré sur les visages — plus d’épaules" },
      { d: "02/08", t: "Progression UI qui ne redescend plus à 0 %" },
    ],
  },
  {
    slug: "1-fiabilite-juillet",
    number: 1,
    label: "Édition #1",
    date: "29 juillet 2026",
    title: "Fiabilité, file d’attente & clips qui restent",
    lead:
      "Fin juillet, on a reconstruit le cœur du pipeline clips. Moins de jobs fantômes, plus de capacité, une facturation plus juste — et une UI qui ne clignote plus pour rien.",
    teaser:
      "File multi-serveurs, jobs qui ne disparaissent plus, facturation Stripe, UI plus stable.",
    oneLiner:
      "Upcut peut maintenant enchaîner beaucoup plus de générations en parallèle sans perdre tes clips à la fin — ni les marquer en erreur alors qu’ils sont prêts.",
    blocks: [
      {
        kicker: "01 — Scale",
        title: "Plusieurs machines, une seule file",
        body: [
          "Avant, chaque serveur Upcut gardait les jobs clips dans sa propre mémoire. Un redémarrage, un second serveur, et le job pouvait « disparaître » : l’interface affichait une erreur alors que le travail n’était peut‑être pas perdu — juste invisible.",
          "On a basculé sur une file partagée dans Supabase. Tous les workers Railway piochent le prochain job dans le même ordre (FIFO), un à la fois par machine. Résultat : on peut monter à plusieurs replicas sans se marcher dessus.",
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
          "L’ancien reaper se basait seulement sur la date de création : il tuait des jobs encore pending. On a aussi corrigé un reclaim trop agressif qui volait des jobs Whisper/ffmpeg encore vivants.",
        ],
        bullets: [
          "On ne touche pas aux jobs dont le backend est encore pending ou processing",
          "Reclaim uniquement si plus de heartbeat depuis assez longtemps",
        ],
        outcome: "Attendre dans la file ≠ erreur. Seuls les vrais zombies (worker mort) sont recyclés.",
      },
      {
        kicker: "05 — Interface",
        title: "Moins de flicker pendant le polling",
        body: [
          "Quand le backend mettait trop longtemps à répondre, l’UI passait parfois en erreur puis revenait — un flash désagréable sur la page projet.",
          "Désormais, un timeout de poll est un soft-fail : on garde le dernier statut connu au lieu de faire croire que le job a planté.",
        ],
        outcome: "La page projet respire : plus de yo-yo loading → erreur → loading.",
      },
      {
        kicker: "06 — Argent",
        title: "Stripe + crédits qui ne double-comptent pas",
        body: [
          "Le checkout Creator / Studio passe par Stripe (plus Lemon Squeezy sur le parcours principal).",
          "La facturation des minutes de clips est retry-safe : même si tu recharges la page pile au moment où le job passe à done, on ne te re-débitera pas.",
        ],
        outcome: "Upgrade clair depuis les tarifs, crédits cohérents même en cas de retry réseau.",
      },
      {
        kicker: "07 — Qualité clips",
        title: "Whisper, uploads, split & rendu",
        body: [
          "Dans le même sprint : découpage Whisper plus robuste, hooks plus propres sur les uploads, moins de faux positifs split sur les monologues, et un réglage ffmpeg pour éviter les plantages mémoire sur Railway Hobby.",
          "Les uploads peuvent aussi court-circuiter la détection de « moments viraux » quand tu sais déjà ce que tu veux couper — moins d’attente inutile.",
        ],
        outcome: "Moins d’échecs silencieux au rendu, meilleurs découpages sur podcasts et longs formats.",
      },
    ],
    timeline: [
      { d: "28/07", t: "File partagée multi-replicas + capacité ×N" },
      { d: "28/07", t: "Billing crédits idempotent + Stripe au premier plan" },
      { d: "29/07", t: "Reaper STALE corrigé — plus de jobs morts à tort" },
      { d: "29/07", t: "Poll UI soft-fail — plus de flicker" },
      { d: "29/07", t: "Sync forcée done → projet + heal des zombies" },
      { d: "29/07", t: "Race 80 % neutralisée (code + trigger SQL)" },
    ],
    underTheHood: [
      "Tables clés : clip_jobs (ce que tu vois) et clip_backend_jobs (ce que les workers exécutent). Elles doivent rester alignées.",
      "Claim SQL FIFO avec verrouillage coopératif, heartbeats, triggers Postgres pour le miroir done et l’interdiction de downgrade.",
      "Détail technique interne : docs/MODIFS_28-29_JUILLET_2026.md dans le repo.",
    ],
  },
];

export function getNewsletterIssue(slug: string): NewsletterIssue | undefined {
  return NEWSLETTER_ISSUES.find((i) => i.slug === slug);
}

export function getLatestNewsletterIssue(): NewsletterIssue {
  return [...NEWSLETTER_ISSUES].sort((a, b) => b.number - a.number)[0]!;
}
