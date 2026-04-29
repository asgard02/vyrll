# CODE_AUDIT.md — Vyrll
> À coller dans Cursor. Deux parties : le prompt d'instruction (ce que Cursor doit faire), puis la checklist (ce qu'il doit vérifier point par point).

---

## PARTIE 1 — PROMPT CURSOR

```
Tu es un ingénieur senior chargé d'un audit offensif du codebase Vyrll.
Ton rôle n'est pas de corriger le code — uniquement de trouver les problèmes structurels AVANT qu'ils deviennent des bugs en production.

Contexte du projet :
- Backend Node.js/Express (backend-clips/server.js) : pipeline yt-dlp → Whisper → GPT → render → upload
- Script Python (render_subtitles.py) : smart crop 2 passes + Pillow + pipe ffmpeg
- Frontend Next.js App Router (src/app/api/clips/ et src/app/clips/)
- Base de données : Supabase PostgreSQL
- Stockage : Cloudflare R2
- Déploiement : Railway CPU-only, 1 réplica, jobs en RAM

Pour CHAQUE fichier que tu lis, applique la checklist ci-dessous dans l'ordre.
Pour chaque problème trouvé, produis une entrée structurée ainsi :

---
FICHIER : <chemin>
FONCTION : <nom de la fonction ou bloc concerné>
CATÉGORIE : <Data Structure | Algorithm | System Design | Error Handling | State Management | API Contract | Security | Performance>
SÉVÉRITÉ : <Critique | Haute | Moyenne | Faible>
SYMPTÔME PROBABLE : <ce que l'utilisateur verrait en prod>
CAUSE RACINE : <pourquoi ça existe structurellement>
LIGNE(S) : <numéro(s) approximatif(s)>
---

Ne propose pas de fix dans ce document. Uniquement le diagnostic.
Si un fichier est sain sur un point, ne le mentionne pas — uniquement les problèmes.
Commence par backend-clips/server.js, puis render_subtitles.py, puis les routes API Next.js.
```

---

## PARTIE 2 — CHECKLIST D'AUDIT

Cursor doit vérifier chaque point ci-dessous sur chaque fichier ciblé.

---

### A. Data Structures

- [ ] **A1 — Map en RAM comme base de données**
  Les `Map` ou objets utilisés pour stocker l'état des jobs survivent-ils à un redémarrage ? Si non, quel est le risque de perte silencieuse ?

- [ ] **A2 — Tableaux vs objets pour la lookup**
  Y a-t-il des `.find()` ou `.filter()` sur de grands tableaux où une `Map` ou un index serait O(1) ?

- [ ] **A3 — Mutation d'objet partagé**
  Des objets sont-ils mutés directement sans copie (spread/clone) dans des contextes asynchrones ? Risque de race condition.

- [ ] **A4 — Données non typées depuis GPT/Whisper**
  Les réponses JSON de GPT et Whisper sont-elles validées structurellement avant utilisation, ou utilisées directement avec des accès de type `response.choices[0].message.content` sans guard ?

- [ ] **A5 — Null / undefined non gardés**
  Y a-t-il des accès en chaîne (`a.b.c`) sur des valeurs qui peuvent être `null` ou `undefined` (ex : résultats Supabase, réponses API externes) sans optional chaining ou guard explicite ?

---

### B. Algorithms

- [ ] **B1 — Complexité cachée dans les boucles**
  Y a-t-il des boucles imbriquées sur des tableaux de segments Whisper (potentiellement 500–2000 éléments) qui tournent en O(n²) ou pire ?

- [ ] **B2 — Recherche linéaire répétée**
  Des fonctions comme `enforceCleanEnd/Start` ou `buildWordPauseBoundaries` font-elles plusieurs passes sur le même tableau qu'on pourrait pré-indexer une seule fois ?

- [ ] **B3 — Arithmétique flottante sur les timestamps**
  Les comparaisons de timestamps (secondes) utilisent-elles `===` ou des comparaisons exactes sur des floats ? Risque de non-égalité silencieuse.

- [ ] **B4 — Gaussian smoothing / scipy — paramètres hardcodés**
  Les valeurs de sigma et window pour le lissage du face tracking sont-elles hardcodées ? Sont-elles validées pour ne pas produire de positions hors frame (cx < 0 ou > 1) ?

- [ ] **B5 — Conditions de sortie des boucles de rendu**
  La boucle de frames pass 2 dans `render_subtitles.py` a-t-elle une condition de sortie propre si `cap.read()` retourne `False` avant la fin prévue ? Ou boucle-t-elle sur des frames vides ?

---

### C. System Design

- [ ] **C1 — Couplage fort pipeline Node ↔ Python**
  Le script Python est appelé via `spawn`. Si le script se termine avec un code non-zéro sans message stderr, Node le détecte-t-il ? Ou continue-t-il silencieusement ?

- [ ] **C2 — Pas de timeout sur les appels externes**
  Les appels à Whisper API, GPT, yt-dlp ont-ils des timeouts explicites ? Qu'arrive-t-il si Whisper met 10 min à répondre — le job reste bloqué en `processing` indéfiniment ?

- [ ] **C3 — Upload R2 sans retry**
  L'upload vers Cloudflare R2 est-il entouré d'une logique de retry ? Un échec réseau transitoire marque-t-il le job entier en erreur ?

- [ ] **C4 — Pas de queue de jobs**
  Plusieurs jobs peuvent-ils être traités en parallèle sur la même instance Railway ? Si oui, la concurrence sur les fichiers temporaires (même nom de fichier ?) est-elle gérée ?

- [ ] **C5 — Nommage des fichiers temporaires**
  Les fichiers temporaires (proxy, clips intermédiaires) utilisent-ils un identifiant unique par job ? Deux jobs simultanés peuvent-ils écraser les fichiers de l'autre ?

- [ ] **C6 — Supabase RLS vs Service Role**
  Les routes API Next.js utilisent-elles le client `service_role` là où elles devraient utiliser le client auth utilisateur ? Un accès `service_role` bypass la RLS — vérifier que ce n'est pas utilisé par défaut sur les lectures user-specific.

- [ ] **C7 — Propagation du jobId backend vs Supabase**
  Le `backend_job_id` est-il écrit dans Supabase immédiatement après création du job backend ? Ou y a-t-il une fenêtre où le poll Next.js cherche un `backend_job_id` encore null ?

---

### D. Error Handling

- [ ] **D1 — Erreurs avalées silencieusement**
  Y a-t-il des `catch (e) {}` vides ou des `catch` qui loggent mais ne propagent pas l'erreur, laissant le job dans un état `processing` indéfini ?

- [ ] **D2 — Fallback sans signal**
  Le fallback `cutAndReformatNoSubtitles` (clips sans karaoké) est déclenché sans notifier l'utilisateur. Y a-t-il d'autres fallbacks silencieux similaires dans le pipeline ?

- [ ] **D3 — Codes d'erreur non mappés**
  Si `backend-clips` retourne un code d'erreur inconnu, `clip-errors.ts` a-t-il un fallback générique ? Ou l'UI affiche-t-elle un code brut incompréhensible ?

- [ ] **D4 — Erreurs Python non capturées côté Node**
  Si `render_subtitles.py` lève une exception non catchée (ex : ImportError sur scipy), Node reçoit-il un code de sortie non-zéro et le détecte-t-il correctement ?

- [ ] **D5 — Timeout Whisper sans cleanup**
  Si l'appel Whisper timeout, le fichier audio temporaire est-il supprimé ? Ou s'accumule-t-il sur le disque Railway jusqu'à saturation ?

---

### E. State Management

- [ ] **E1 — États de job incohérents**
  Un job peut-il rester bloqué en `processing` si le backend crashe entre deux étapes sans écrire `error` dans Supabase ? Quel est le mécanisme de récupération ?

- [ ] **E2 — Double débit de crédits**
  Si `increment_credits_used` est appelé deux fois pour le même job (ex : retry du webhook, double poll qui passe à `done`), y a-t-il une protection idempotente ?

- [ ] **E3 — Race condition poll**
  Si deux onglets du même utilisateur pollent le même `jobId` simultanément, peuvent-ils tous les deux déclencher `increment_credits_used` au moment où le statut passe à `done` ?

- [ ] **E4 — sessionStorage comme source de vérité**
  `vyrll_pending_clip_url` dans sessionStorage est-il nettoyé après utilisation ? Ou peut-il pré-remplir le dashboard avec une URL obsolète lors d'une navigation ultérieure ?

---

### F. API Contract

- [ ] **F1 — Schéma de réponse non versionné**
  Le contrat JSON entre `backend-clips/server.js` et `src/app/api/clips/[jobId]/route.ts` est-il documenté ? Un champ renommé côté backend casse-t-il silencieusement le frontend ?

- [ ] **F2 — Paramètres optionnels non validés**
  Les paramètres `start_time_sec`, `duration_min`, `duration_max` dans `POST /api/clips/start` sont-ils validés côté API Next.js avant d'être transmis au backend ? Un `start_time_sec` négatif ou > durée source est-il géré ?

- [ ] **F3 — BACKEND_SECRET non vérifié sur toutes les routes**
  Toutes les routes Express de `backend-clips` vérifient-elles le header `BACKEND_SECRET` ? Ou certaines routes internes sont-elles accessibles publiquement ?

- [ ] **F4 — Réponse GPT non validée structurellement**
  Si GPT retourne un JSON malformé ou sans le champ `moments`, le pipeline crashe-t-il proprement avec un code d'erreur, ou lève-t-il une exception non catchée ?

---

### G. Performance & Ressources

- [ ] **G1 — Fichiers temporaires non nettoyés**
  Y a-t-il un `finally` ou équivalent qui supprime les fichiers temporaires (proxy, audio, clips intermédiaires) même en cas d'erreur ? Ou le disque Railway se remplit-il progressivement ?

- [ ] **G2 — Chargement Whisper complet en mémoire**
  Le fichier audio est-il chargé entièrement en RAM avant envoi à Whisper, ou streamé ? Pour une vidéo 30 min, ça peut représenter plusieurs centaines de Mo.

- [ ] **G3 — OpenCV frame-by-frame sans batch**
  Le face tracking pass 1 lit-il chaque frame individuellement via `cap.read()` dans une boucle Python pure ? Y a-t-il un sous-échantillonnage (1 frame sur N) pour éviter de traiter 50 000 frames ?

- [ ] **G4 — Logs verbeux en prod**
  Y a-t-il des `console.log` ou `print` qui loggent des données volumineuses (transcriptions complètes, tableaux de segments) en prod ? Ça ralentit le I/O et pollue les logs Railway.

---

### H. Sécurité

- [ ] **H1 — URL YouTube non validée**
  L'URL passée à yt-dlp est-elle validée/sanitisée avant exécution ? Une URL malformée ou une injection shell est-elle possible ?

- [ ] **H2 — Injection dans les noms de fichiers**
  Les noms de fichiers temporaires construits à partir de l'URL ou du jobId échappent-ils les caractères spéciaux (espaces, `..`, `/`) ?

- [ ] **H3 — Exposition des variables d'environnement**
  Des variables sensibles (`OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) sont-elles loggées accidentellement dans les logs d'erreur ou dans les réponses API ?

---

## Format de sortie attendu de Cursor

Cursor doit produire un fichier `AUDIT_REPORT.md` avec :

1. **Résumé exécutif** : nombre de problèmes par sévérité et par catégorie
2. **Top 5 risques critiques** à traiter en priorité
3. **Liste complète** des problèmes trouvés au format structuré défini dans le prompt
4. **Points sains** : liste des catégories où aucun problème n'a été trouvé

---

*Ce document est un outil d'audit, pas un fix. Les corrections vont dans BUGFIX_RUNBOOK.md.*
