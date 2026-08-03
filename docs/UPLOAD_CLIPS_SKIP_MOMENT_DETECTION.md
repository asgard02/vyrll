# Upload clips : ne plus chercher les « meilleurs moments »

**Statut :** implémenté  
**Dates :** 2026-07-27 (upload) · 2026-08-03 (URL manuel = zone + durée cible)

## Comportement

```
UPLOAD (auto)
  → Whisper → 1 clip = [0 → duration] → rendu → done

UPLOAD (manuel)
  → Whisper → 1 clip = [search_window_start → search_window_end] exact → done

URL (manuel)
  → segment download de la zone
  → Whisper → detectMoments (duration_min/max) dans la zone
  → clips ≤ duration_max → rendu → done

URL (auto)
  → Whisper → detectMoments → multi-clips
```

### Règles

1. `source === "upload"` → **jamais** `detectMoments`.
2. URL manuel → zone de recherche + **durée cible** (15–30 … 90–120) ; clips **clampés** à `duration_max`.
3. Fenêtre URL manuel ≥ `duration_max` (sinon l’option de durée est invalide côté UI/API).
4. Upload manuel : extrait exact, min 5 s ; pas de sélecteur de durée cible.
### Invariants

- Crédits manuel = durée de la **zone** (pas de toute la VOD).
- Clip URL jamais plus long que `duration_max`.
