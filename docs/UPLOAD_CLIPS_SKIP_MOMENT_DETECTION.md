# Upload clips : mêmes moments viraux que YouTube et Twitch

**Statut :** implémenté  
**Dates :** 2026-07-27 (upload = fichier entier) · 2026-09-24 (upload = `detectMoments`)

## Comportement

```
UPLOAD (auto)
  → Whisper → detectMoments (duration_min/max) → plusieurs clips → done

UPLOAD (manuel)
  → Whisper sur la fenêtre → detectMoments dans la zone → clips ≤ duration_max → done

URL (manuel)
  → segment download de la zone
  → Whisper → detectMoments (duration_min/max) dans la zone
  → clips ≤ duration_max → rendu → done

URL (auto)
  → Whisper → detectMoments → multi-clips
```

### Règles

1. `source === "upload"` suit le même `detectMoments` que les URL. Plus de clip `0 → fin du fichier`.
2. Si la source (fichier ou fenêtre) tient déjà dans `duration_max`, un seul clip — comme un Short.
3. URL manuel → zone de recherche + durée cible (15–30 … 90–120) ; clips clampés à `duration_max`.
4. Upload manuel : même détection dans la fenêtre, pas l’extrait brut.

### Invariants

- Crédits manuel = durée de la **zone** (pas de toute la VOD).
- Clip jamais plus long que `duration_max`, sauf source déjà plus courte que cette borne.
