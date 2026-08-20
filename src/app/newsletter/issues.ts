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
    slug: "6-moments-payoff-groq",
    number: 6,
    label: "Édition #6",
    date: "18 août 2026",
    title: "Le clip doit finir sur la punchline — pas sur le premier point",
    lead:
      "Mi-août, le chantier n’était plus le cadrage : c’était le moment lui-même. Groq a pris la transcription et la détection. Puis on a vu que les clips s’arrêtaient trop tôt, qu’ils s’entassaient dans les dix premières minutes, et qu’un JSON vide tuait tout le job. Trois couches, un seul ressenti : tu reçois enfin des extraits qui tiennent jusqu’à la révélation.",
    teaser:
      "Whisper et détection passés sur Groq, moments répartis sur toute la VOD, coupe déplacée jusqu’à la punchline — et plus de job mort parce que le modèle a renvoyé {}.",
    oneLiner:
      "Upcut cherche maintenant des moments sur toute la source, et recule la fin du clip jusqu’à la révélation — tant que ça tient dans la durée que tu as choisie.",
    blocks: [
      {
        kicker: "01 — Le coût caché",
        title: "Whisper coûtait presque tout. GPT presque rien.",
        body: [
          "Le poste dominant n’était pas « l’IA qui choisit les clips ». C’était la transcription de toute la vidéo. On a basculé Whisper et la détection de moments vers Groq : même job, autre facture. Le rendu ffmpeg, lui, n’a pas bougé — c’est volontaire.",
          "Sauf que changer de modèle, ce n’est pas un find-and-replace. Llama 3.3 a été retiré. Le JSON mode de gpt-oss renvoyait 400. Un tableau `moments: []` abortait le job avant le filet de secours. En prod, ça s’appelait PROCESSING_FAILED sur une VOD tout à fait normale.",
        ],
        bullets: [
          "STT : whisper-large-v3-turbo (Groq) à la place de whisper-1",
          "Chat : gpt-oss, puis Qwen en secours — plus de 404 sur un modèle retiré",
          "Un JSON vide ou cassé ne tue plus le job : retry, autre modèle, puis fenêtres réparties",
        ],
        outcome:
          "La génération continue. Tu n’as plus un projet rouge parce que le parseur n’a pas aimé la réponse.",
      },
      {
        kicker: "02 — Le premier tiers",
        title: "Toute la VOD était transcrite. Seules les 10 premières minutes étaient clipées.",
        body: [
          "Groq transcrivait bien l’heure. Puis le modèle de moments ne voyait qu’un mur de lignes Whisper trop fines — il piochait dans l’intro, et s’arrêtait. Sur une Studio de 40 minutes, les trois clips sortaient du premier bloc. Le reste de la conversation n’existait pas.",
          "On compacte maintenant les lignes en blocs de quelques secondes, et on impose début / milieu / fin dès que la source dépasse ~12 minutes. Si la couverture reste trop basse, une seconde passe force l’étalement.",
        ],
        outcome:
          "Une VOD longue donne des clips dans l’intro et plus loin. Plus un trio coincé à 8:00.",
      },
      {
        kicker: "03 — La coupe",
        title: "Le premier point n’est pas la punchline.",
        body: [
          "« Dernier mot ? Non. » — puis la réponse. L’ancien cut tombait sur le point d’interrogation. Le clip était grammaticalement fini. Il était narrativement mort.",
          "Après la détection, un passage extra lit ce qui vient après la coupe. Si la révélation est encore dans ta durée max, on recule la fin jusqu’à là. Et la durée min n’est plus un parking : un 60–90 vise le haut de la plage quand l’idée continue, au lieu de s’arrêter à 1:01 par politesse.",
        ],
        bullets: [
          "Un seul appel de refine pour tout le lot (timeout 20 s) — pas un aller-retour par clip",
          "Whisper bilingue : une intro EN sur une source FR ne colonise plus tout le sous-titrage",
          "Gros upload et « Refaire des clips » réutilisent le fichier déjà là",
        ],
        outcome:
          "Le fichier s’arrête quand l’idée s’arrête. Pas au premier silence poli.",
      },
      {
        kicker: "04 — Ce que tu ressens",
        title: "Partager un dossier. Reprendre le lien collé.",
        body: [
          "Sur un projet terminé : Partager copie un lien `/s/…`. La personne en face crée un compte (ou se connecte), revoit les clips, télécharge le lot. Plus d’envoi pièce par pièce.",
          "Et si tu colles l’URL sur la landing avant d’être connecté : le lien survit à Google, à l’email, au va-et-vient login / register. Le modal d’options s’ouvre avec la même vidéo — y compris l’alerte crédits si la source est trop longue pour le solde.",
        ],
        outcome:
          "Moins de friction autour du clip. Le travail, c’est encore le moment — pas le lien perdu après signup.",
      },
    ],
    timeline: [
      { d: "16/08", t: "Whisper + détection de moments : OpenAI → Groq" },
      { d: "16/08", t: "Moments étalés sur toute la VOD (plus seulement l’intro)" },
      { d: "16/08", t: "Refine de fin : la coupe suit la punchline, dans la durée max" },
      { d: "16/08", t: "Landing : l’URL collée survit à l’inscription" },
      { d: "17/08", t: "Whisper bilingue, fallback Groq, reuse des uploads" },
      { d: "18/08", t: "JSON Groq cassé / moments vides → retry au lieu d’un job mort" },
      { d: "18/08", t: "Lien de partage d’un dossier de clips (compte requis)" },
    ],
    underTheHood: [
      "detectMoments compacte les lignes Whisper, impose des bins début/milieu/fin, retry JSON sans json_object, puis Qwen, puis fenêtres heuristiques — plus d’abort sur moments:[].",
      "refine-end : un appel Groq pour le lot, borné par duration_max. Whisper : chunks auto + gap-fill après intro EN.",
      "Partage : route /s/{token}, hors robots.txt. Auth conserve ?next= pour ne pas perdre le dossier après verify-email.",
    ],
  },
  {
    slug: "5-gaming-cam-couts",
    number: 5,
    label: "Édition #5",
    date: "15 août 2026",
    title: "La webcam du streamer — pas le perso Valorant",
    lead:
      "Le mode Gaming existait. Il se trompait encore de visage. Sur une select d’agents, le crop accrochait le buste peint à l’écran au lieu de la petite caméra en overlay. En parallèle, on a coupé ce qui coûtait cher sans changer un pixel du fichier que tu télécharges — et resserré le free pour les nouveaux comptes.",
    teaser:
      "Facecam verrouillée sur l’overlay, gameplay centré, crédits free à 10 pour les nouveaux, cache Whisper, plus de second encode inutile sur le plan gratuit.",
    oneLiner:
      "En Gaming, Upcut lock la webcam du streamer — y compris en haut à gauche — et ignore les visages du jeu. Le rendu subtitled, lui, reste le même free ou payant.",
    blocks: [
      {
        kicker: "01 — Le mauvais visage",
        title: "L’agent select n’est pas une facecam.",
        body: [
          "Le layout Gaming empile cam en haut, jeu en bas. Encore faut-il que « cam » soit la webcam. Sur Valorant, LoL, n’importe quel écran plein de portraits, le détecteur préférait la plus grosse tête — souvent un perso, un buste peint, un splash. Le streamer, lui, tenait dans un rectangle de 200 pixels.",
          "On lock maintenant l’overlay (coin haut gauche / droite, PiP). Le panneau jeu se centre sur la croix / la buy phase, le buste garde les épaules sans faire fuiter la minimap au-dessus de la cam, et les sous-titres Gaming s’asseyent sur la couture cam/jeu — 1 s par mot, ils disparaissent dès que ça se tait.",
        ],
        bullets: [
          "Toggle renommé Gaming — le chemin talk (mono / split) ne passe toujours pas par ce stack",
          "Peau réelle préférée aux bustes peints",
          "Captions Gaming plus sèches que le talk : pas de pavé collé 5 secondes sur un silence",
        ],
        outcome:
          "Tu vois le streamer. Pas Jett en select. Le jeu reste lisible en dessous.",
      },
      {
        kicker: "02 — Le second fichier",
        title: "Free n’avait pas besoin d’un -clean.mp4.",
        body: [
          "Chaque job gratuit encodait aussi une version sans sous-titres — utile seulement pour rééditer les captions, une feature Creator / Studio. Même pipeline subtitled, même qualité à l’écran, un encode et un upload en moins sur le plan free.",
          "Même URL, même fenêtre manuelle : la transcription Whisper est recachée. Relancer ne refait pas payer la minute. L’audio de rendu passe à 192k pour tout le monde — ce n’est pas une baisse de qualité, c’est le défaut qu’on aurait dû avoir.",
        ],
        outcome:
          "Le MP4 que tu télécharges n’a pas changé. La facture Whisper, si tu relances, si.",
      },
      {
        kicker: "03 — Le quota",
        title: "10 minutes pour tester. Pas 30 à fonds perdu.",
        body: [
          "Les nouveaux comptes free ont 10 crédits à vie (1 crédit = 1 min de source) — à peu près trois clips pour juger. Les comptes déjà là gardent 30 : pas de backfill punitif.",
          "Les projets free expirent au bout de deux jours (fichiers + fiche). Creator / Studio : rien ne disparaît. Et si tu lances une 35 minutes avec 10 crédits, le modal le dit en rouge avant le clic — plus un bouton grisé sans phrase.",
        ],
        bullets: [
          "YouTube trop long : bannière claire, generate bloqué, plus de « essaie le manuel » alors que le manuel YouTube est fermé",
          "Annuler un download YouTube n’enchaîne plus un fallback « qualité pourrie » comme si la chaîne 720p était morte",
        ],
        outcome:
          "Le free reste un essai. Il arrête de faire semblant d’être un plan.",
      },
    ],
    timeline: [
      { d: "08/08", t: "Alerte crédits insuffisants dans le modal, avant le clic" },
      { d: "08/08", t: "Clips free : purge auto à 2 jours" },
      { d: "11/08", t: "Nouveaux free : 10 crédits (les 30 existants inchangés)" },
      { d: "11/08", t: "Skip encode clean sur free + cache Whisper + AAC 192k" },
      { d: "13/08", t: "Gaming : overlay cam, jeu centré, captions sur la couture" },
      { d: "15/08", t: "Peau réelle > buste peint ; yt-dlp default, cancel sans faux fallback" },
    ],
    underTheHood: [
      "stream_layout.py : lock overlay webcam, crop buste, captions 1s/mot sur la seam. Talk 9:16 sans toggle Gaming inchangé.",
      "R2 : plus de *-clean.mp4 sur free. Cache transcriptions/v1/… (URL + fenêtre manuelle). Reaper horaire + GET /api/cron/cleanup-expired-clips.",
      "yt-dlp YouTube : player_client=default ; un cancel utilisateur n’ouvre plus le fallback loose ≥480.",
    ],
  },
  {
    slug: "4-mode-gaming-sync",
    number: 4,
    label: "Édition #4",
    date: "8 août 2026",
    title: "Un stream n’est pas un podcast — donc le crop non plus",
    lead:
      "Le 4 août, on a isolé un chemin Stream / gaming : facecam en haut, gameplay en bas, sans passer par le smart-crop talk. Dans la foulée, Twitch livrait des sous-titres en retard de deux secondes, YouTube faisait sauter la RAM du worker, et un décalage forcé « −2 s » empirait le cas où il n’y avait presque pas de parole. Une semaine à recoller l’image, le son, et le texte.",
    teaser:
      "Nouveau layout Gaming (cam + jeu), sync Twitch réelle au lieu d’un −2 s magique, sous-titres qui ne restent plus collés 5 secondes dans le silence.",
    oneLiner:
      "Coche Gaming : Upcut empile webcam et jeu en 9:16, et aligne les captions sur l’audio — plus un décalage de deux secondes « pour voir ».",
    blocks: [
      {
        kicker: "01 — Deux produits dans le même bouton",
        title: "Le crop talk détruisait les VOD de jeu.",
        body: [
          "Mono / split, c’est fait pour des visages autour d’une table. Sur un stream, la tête utile est un rectangle dans le coin, et le sujet c’est la map. Passer ça dans le même smart-crop, c’était zoomer n’importe où — ou traiter le perso comme un invité de podcast.",
          "Chemin isolé : content_family=stream. Stack ~47 % facecam / reste gameplay. Le talk (podcast, just chatting) ne rentre pas dans ce code. Early-exit. Deux contrats, un toggle.",
        ],
        outcome:
          "Just chatting reste du talk. Une ranked a enfin un layout de ranked.",
      },
      {
        kicker: "02 — Les deux secondes",
        title: "On avait compensé trop fort.",
        body: [
          "Les captions Gaming arrivaient en retard. Le réflexe : pousser tout le monde de −2 s. Sur une VOD où la bande parole est presque vide, ce lead forcé décalait dans l’autre sens. Les lèvres disaient une chose, le texte une autre — ou le texte une phrase déjà finie.",
          "Twitch, en plus, livrait parfois image et son qui ne commençaient pas au même endroit (PTS plats, trim=0). On réaligne V/A sur les packets, on décode les frames stream avec ffmpeg sur la même horloge que l’audio, et Whisper ne sert plus que d’ajustement ±0,5 s. Si l’offset est fiable, on le croit. On ne pousse plus « plus tard » par principe.",
        ],
        bullets: [
          "Plus de OpenCV POS_FRAMES pour le rendu stream — mauvaise horloge",
          "Logs : trust | fallback | clamp_positive — une décision, pas un magic number",
          "Twitch négatif côté PTS : ignoré pour le trim, au lieu de casser le sync",
        ],
        outcome:
          "Tu parles, le mot apparaît. Le silence, le mot s’en va. Plus un lag de replay YouTube.",
      },
      {
        kicker: "03 — Le silence",
        title: "Whisper étirait les blocs. Le texte restait collé.",
        body: [
          "Une phrase courte, puis cinq secondes de rien : le bloc sous-titre occupait tout le trou. Plafond à 2,8 s à l’écran, talk et stream. Le reburn (réécriture des captions) cassait ensuite les mots trop long — on a recollé le split pour ne pas avaler de la parole au milieu d’une phrase.",
        ],
        outcome:
          "Une pause dans le discours n’est plus une légende figée au milieu du 9:16.",
      },
      {
        kicker: "04 — YouTube, la RAM, le manuel",
        title: "Certaines VOD ne doivent plus faire semblant d’être clipables.",
        body: [
          "Le worker Railway tombait OOM en téléchargeant du YouTube : 360p deux fois, puis un merge DASH. On force un 720p progressif, un seul fragment à la fois. Et le mode manuel YouTube est fermé (Twitch et upload, eux, restent). Au-delà d’1h15 en auto, c’est bloqué — avec une bannière, pas un bouton mort.",
        ],
        outcome:
          "Moins de jobs fantômes « serveur a crash ». Moins de « essaie le manuel » sur une source où le manuel n’existe pas.",
      },
    ],
    timeline: [
      { d: "04/08", t: "Mode Stream / gaming isolé (stack cam + jeu)" },
      { d: "04/08", t: "YouTube : download ram-safe, manuel fermé, limites visibles" },
      { d: "04/08", t: "Twitch A/V realign + decode ffmpeg (plus de −2 s forcé)" },
      { d: "05/08", t: "Captions plafonnées à 2,8 s ; reburn qui ne mange plus les mots" },
      { d: "08/08", t: "Alerte crédits + expiration free 2 jours (suite en #5)" },
    ],
    underTheHood: [
      "stream_layout.py + flag --stream-stack. Talk mono/split : early-exit, non modifié dans cette édition.",
      "Segment Twitch : sync par PTS / nb_frames / download V+A séparés. Whisper offset borné à ±0,5 s.",
      "yt-dlp YouTube : format progressif height>=720, concurrent-fragments 1 — évite le double 360p + merge qui tuait Railway (~25 Go).",
    ],
  },
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
