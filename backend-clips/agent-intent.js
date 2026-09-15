export function parseAgentIntentContract(raw) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return normalizeIntentV1(raw);
  }
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  if (s.startsWith("{")) {
    try {
      const parsed = JSON.parse(s);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const contract = normalizeIntentV1(parsed);
        if (contract) return contract;
      }
    } catch {
      /* legacy sentence */
    }
  }
  return {
    v: 1,
    mode: "theme",
    quantity: "all",
    focus: s.slice(0, 200),
  };
}

export function parseIntentQuantity(raw) {
  if (raw === "all") return "all";
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 8) {
    return raw;
  }
  if (typeof raw === "string" && /^[1-8]$/.test(raw)) return Number(raw);
  return null;
}

function normalizeIntentV1(rec) {
  if (rec.v !== 1 && rec.v !== "1") return null;
  const mode = rec.mode === "best" || rec.mode === "theme" ? rec.mode : null;
  if (!mode) return null;
  return {
    v: 1,
    mode,
    quantity: parseIntentQuantity(rec.quantity) ?? "all",
    focus: typeof rec.focus === "string" ? rec.focus.trim().slice(0, 200) : "",
  };
}

export function requestedMomentsMax(contract, momentsMax) {
  const cap = Math.max(1, Math.min(50, Math.floor(Number(momentsMax) || 1)));
  const q = contract?.quantity;
  if (typeof q === "number" && q >= 1) return Math.min(q, cap);
  return cap;
}

export function clipDetectPlan(job, momentsMax) {
  const contract = parseAgentIntentContract(job?.agent_intent);
  const n = requestedMomentsMax(contract, momentsMax);
  return {
    contract,
    n,
    lockOne: n === 1,
  };
}

/** How many clips this job should actually deliver (not the GPT overscan). */
export function clipWantCount(plan, clipsMax) {
  if (plan?.lockOne) return 1;
  const cap = Math.max(1, Math.floor(Number(clipsMax) || plan?.n || 1));
  const q = plan?.contract?.quantity;
  if (typeof q === "number" && q >= 1) return Math.min(plan.n, cap);
  return cap;
}
