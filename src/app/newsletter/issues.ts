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
    slug: "3-mode-manuel-zone-duree",
    number: 3,
    label: "Édition #3",
    date: "3 août 2026",
    title: "Mode manuel : la zone n’est pas le clip",
    lead:
      "Sur une URL en mode manuel, j’avais choisi une durée cible 60–90 s. Le rendu est sorti à 1 min 45 — 105 secondes. Hors plage. Absurde. Mon hypothèse : le système ne choisissait plus un moment dans la fenêtre, il rendait toute la plage timeline. C’était ça.",
    teaser:
      "Un clip à 105 s alors que la cible était 60–90. La preuve que le mode manuel URL prenait tout le segment — et comment on l’a recadré.",
    oneLiner:
      "En mode manuel sur une URL, tu choisis une zone de recherche + une durée cible. Upcut y cherche un bon moment — il ne te livre plus toute la plage comme un seul clip géant.",
    blocks: [
      {
        kicker: "01 — Le moment où ça cloche",
        title: "60–90 à l’écran. 1:45 dans le fichier.",
        body: [
          "Le déclic n’est pas venu d’un log obscur. Il est venu d’une vidéo courte, banale à tester : durée cible 60–90 secondes. Le clip livré faisait 1 minute 45 — cent cinq secondes. Impossible si le pipeline respectait vraiment la plage choisie.",
          "Quand un chiffre sort clairement hors de la case que tu as cochée, tu arrêtes de blâmer le « feeling » du rendu. Tu regardes le contrat produit : est-ce qu’on coupe un moment, ou est-ce qu’on exporte la fenêtre entière ?",
        ],
        outcome:
          "105 s > 90 s. Une seule observation, et l’hypothèse devient prioritaire.",
      },
      {
        kicker: "02 — L’hypothèse",
        title: "Pas une durée auto. Tout le segment.",
        body: [
          "L’intuition : en manuel URL, on ne cherchait plus un clip « dans » la timeline. On prenait la plage sélectionnée telle quelle — début → fin — et on la rendait d’un bloc. Sous-titres, format, le packaging habituel… mais zéro sélection de moment à l’intérieur.",
          "Ça peut sembler proche de l’upload (où l’extrait exact a du sens : tu as déjà tranché le contenu). Sur une VOD YouTube / Twitch, c’est autre chose : la fenêtre sert à dire « cherche ici », pas « livre-moi ces sept minutes en vertical ».",
        ],
        bullets: [
          "Si la fenêtre = le clip, une cible 60–90 ne peut jamais sortir 105 s… sauf si on ignore la cible",
          "Les logs confirment ensuite : skip detectMoments → 1 clip = toute la plage",
          "Upload garde l’extrait exact ; URL manuel ne doit pas copier ce comportement",
        ],
        outcome:
          "Hypothèse validée. Le bug n’était pas « l’IA choisit mal » — c’était « l’IA ne choisit plus ».",
      },
      {
        kicker: "03 — Pourquoi c’était arrivé",
        title: "Aligner URL sur upload… un cran trop loin",
        body: [
          "On avait voulu simplifier : dès que l’utilisateur désigne le contenu (upload, ou plage manuelle), traiter tel quel — sans chasse aux « meilleurs moments ». Juste pour l’upload, c’est le bon modèle.",
          "En étendant la même règle au manuel URL, on a cassé le produit. La timeline est devenue un trim brutal, plus une zone de recherche. D’où des clips aussi longs que la fenêtre, durée cible ou pas.",
        ],
        outcome:
          "Même bouton « Manuel », deux contrats : upload = extrait ; URL = zone + durée.",
      },
      {
        kicker: "04 — Le correctif",
        title: "Zone + durée. Et un plafond dur.",
        body: [
          "Retour au modèle clair. URL manuel : tu poses une zone (où chercher), tu choisis une durée cible (15–30 … 90–120). Upcut relance la détection de moments dans cette zone uniquement, puis borne chaque clip à duration_max — jamais plus long que ce que tu as demandé.",
          "Upload manuel : inchangé. La plage reste l’extrait exact. Pas de sélecteur de durée « pour décorer » : le fichier (ou la coupe) est déjà le brief.",
        ],
        bullets: [
          "Fenêtre URL ≥ durée max choisie (sinon la zone ne peut pas contenir le clip)",
          "Clamp serveur : fin = début + duration_max si jamais ça déborde",
          "Copy UI : « zone à analyser » vs « extrait à traiter » selon le mode",
        ],
        outcome:
          "Un 60–90 reste un 60–90. Plus de 1:45 fantôme hors plage.",
      },
      {
        kicker: "05 — Ce que tu ressens",
        title: "Manuel utile à nouveau",
        body: [
          "Sur une longue VOD, tu cadrés les dix minutes qui comptent, tu choisis 60–90, tu lances. Tu reçois des clips dans la bonne fourchette — pas un pavé vertical de toute la zone.",
          "Et si tu uploades déjà le bon extrait : tu gardes le rendu fidèle, sans détour IA.",
        ],
        outcome:
          "Le mode manuel redevient un outil de précision, pas un export de timeline déguisé.",
      },
    ],
    timeline: [
      { d: "03/08", t: "Symptôme : clip 105 s pour une cible 60–90" },
      { d: "03/08", t: "Hypothèse : skip detectMoments → 1 clip = toute la fenêtre" },
      { d: "03/08", t: "URL manuel = zone + durée cible + clamp duration_max" },
      { d: "03/08", t: "Upload manuel = extrait exact (inchangé)" },
      { d: "03/08", t: "Copy & validation API alignées sur les deux contrats" },
    ],
    underTheHood: [
      "backend-clips : detectMoments réservé hors upload ; clamp end ≤ start + duration_max sur les clips URL.",
      "API start : min fenêtre URL manuel = duration_max ; upload manuel min 5 s.",
      "UI dashboard : sélecteur de durée visible en manuel URL ; masqué en upload manuel.",
    ],
  },
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
