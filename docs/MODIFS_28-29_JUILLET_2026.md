# Récap modifications — 28–29 juillet 2026

Synthèse des changements prod clips (file multi-replicas, zombies STALE, race `done→processing`).

---

## Contexte

Avant le 28/07, `backend-clips` était pensé **1 réplica / jobs en RAM**.  
Depuis : **file partagée Supabase** + **N replicas Railway** (`MAX_CONCURRENT_JOBS=1` par instance).

---

## Timeline PRs

| Date | PR | Titre |
|------|-----|--------|
| 28/07 | [#43](https://github.com/asgard02/vyrll/pull/43) | Multi-user via replicas + job-slot logs |
| 28/07 | [#44](https://github.com/asgard02/vyrll/pull/44) | File partagée Supabase (`claim_next_clip_backend_job`) |
| 28/07 | [#45](https://github.com/asgard02/vyrll/pull/45) | Skip queue rows sans payload utilisable |
| 28/07 | [#46](https://github.com/asgard02/vyrll/pull/46) | Billing crédits retry-safe (`charge_clip_job_once`) |
| 28/07 | [#47](https://github.com/asgard02/vyrll/pull/47) | 6 replicas, max 3 clips, stale claim 25→… |
| 29/07 | [#48](https://github.com/asgard02/vyrll/pull/48) | Stale reap ne tue plus les jobs encore `pending`/`processing` |
| 29/07 | [#49](https://github.com/asgard02/vyrll/pull/49) | Poll timeout UI : soft-fail (plus de flicker) |
| 29/07 | [#50](https://github.com/asgard02/vyrll/pull/50) | STALE ne tue plus les backends déjà `done` + sync/heal |
| 29/07 | [#51](https://github.com/asgard02/vyrll/pull/51) | Bloque downgrade `done→processing` (race progress=80) |

---

## Migrations Supabase

| Migration | Rôle |
|-----------|------|
| `025_clip_backend_jobs_queue.sql` | Claim FIFO partagé multi-workers |
| `026_claim_requires_payload.sql` | Claim seulement si payload URL/upload OK |
| `027_harden_charge_clip_job_once.sql` | Facturation idempotente |
| `028_faster_stale_claim.sql` | Reclaim processing « morts » (puis corrigé) |
| `029_claim_reclaim_uses_heartbeat.sql` | Reclaim sur `updated_at` > 40 min (plus `claimed_at` 25 min) |
| `030_sync_clip_jobs_on_backend_done.sql` | Trigger : backend `done` → `clip_jobs.done` (+ clips) |
| `031_prevent_backend_done_downgrade.sql` | Trigger : refuse `done` → `pending`/`processing` |

---

## Bugs corrigés (29/07)

### 1. Zombies `STALE_JOB_TIMEOUT`

**Symptôme** : backend `done` avec clips, UI `error` / `STALE_JOB_TIMEOUT` (0 clip).

**Causes** :
- Orphan reap traitait `backend=done` comme mort et marquait `clip_jobs` en STALE sans copier les clips
- Avant #48 : file longue (`created_at` > 40 min) tuée alors que backend encore `pending`
- Sync `clip_jobs` dépendait uniquement du poll Next

**Fix** : sync à chaque persist terminal, promote dans le reap, heal périodique, trigger `030`, heal Next sur faux STALE.

### 2. FE `done` / BE coincé à 80% `processing`

**Symptôme** : UI done + clips ; `clip_backend_jobs` repasse `processing` @ 80%, clips vidés.

**Cause** : race async — `void persist({ progress: 80 })` upsertait **après** `setDone` et écrasait le `done`.

**Fix** : file d’écritures sérialisée par job, skip downgrade mem/DB, `await setDone`, trigger `031`.

### 3. Reclaim qui volait les jobs longs

**Cause** : `claim_next` reclaimait sur `claimed_at` < 25 min (jamais rafraîchi pendant Whisper/ffmpeg).

**Fix** : reclaim uniquement si heartbeat `updated_at` > 40 min (`029`).

---

## Architecture actuelle (prod)

```
Next.js  →  POST /jobs (enqueue clip_backend_jobs pending)
                ↓
N replicas Railway  ×  MAX_CONCURRENT_JOBS=1
                ↓
claim_next_clip_backend_job (FIFO, SKIP LOCKED)
                ↓
processJob → persist (sérialisé) → triggers 030/031 → clip_jobs
                ↓
GET /api/clips/[jobId] (poll HTTP + fallback DB + heal STALE)
```

| Param | Valeur recommandée |
|-------|-------------------|
| Replicas `backend-clips` | ~6 (prod multi-user) |
| `MAX_CONCURRENT_JOBS` | `1` par replica |
| `JOB_STALE_MS` | 40 min (aligné reclaim SQL) |
| `CLIPS_MAX_PER_JOB` | `3` prod / `1` local |
| `RENDER_CONCURRENCY` | `1` Hobby |

---

## État prod (post-fix, 29/07 ~10:30 UTC)

| Check | Valeur |
|-------|--------|
| Zombies STALE | 0 |
| FE done / BE processing | 0 |
| File pending | ~6–10 (descend) |
| Processing | ~12 (heartbeats OK) |
| Done syncés / 30 min | ~20+ |

---

## Fichiers touchés (principaux)

- `backend-clips/server.js` — worker, reap, persist sérialisé, sync/heal
- `src/app/api/clips/[jobId]/route.ts` — soft-fail timeout, heal STALE depuis DB
- `supabase/migrations/025` → `031`
- `backend-clips/.env.example` — doc queue / stale

---

*Mettre à jour ce fichier à chaque incident file/sync clips.*
