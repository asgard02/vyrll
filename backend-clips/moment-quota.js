/** N candidats pour un quota M. Borné : 4 demandés → 10, jamais sous 8 ni au-dessus de 12. */
export function candidateMomentCount(clipsDemandes) {
  const m = Math.max(1, Math.floor(Number(clipsDemandes) || 1));
  return Math.min(12, Math.max(8, Math.round(2.5 * m)));
}

/** Quantité libre (« all » ou pas de contrat). Une quantité chiffrée garde son n. */
export function momentQuotaOpen(plan) {
  if (!plan || plan.lockOne) return false;
  const quantity = plan.contract?.quantity;
  return typeof quantity !== "number";
}

/** Argument n de detectMoments. Le corps de la fonction ne change pas. */
export function momentDetectCount(plan, wantCount, detectN) {
  if (!momentQuotaOpen(plan)) return Math.max(1, Math.floor(Number(detectN) || 1));
  return candidateMomentCount(wantCount);
}

/** Taille de la liste écrite. clips_demandes reste wantCount. */
export function momentWriteCount(plan, wantCount) {
  if (!momentQuotaOpen(plan)) return Math.max(1, Math.floor(Number(wantCount) || 1));
  return candidateMomentCount(wantCount);
}

export function withoutHeuristicPads(moments) {
  if (!Array.isArray(moments)) return [];
  return moments.filter((moment) => {
    const why = typeof moment?.reason === "string" ? moment.reason : moment?.pourquoi;
    return !(typeof why === "string" && why.trim() === "heuristic_pad");
  });
}
