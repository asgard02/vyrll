import type { SupportLocale } from "@/lib/support-chat/prompt";

export const CLIP_AGENT_INTENT_VERSION = 1 as const;

export type ClipAgentMode =
  | "best"
  | "theme"
  | "overview"
  | "clarify"
  | "off_topic";

/** 1–8 = un décompte exact. "all" = tous les pics. null = propositions, l'utilisateur choisit. */
export type ClipAgentQuantity = number | "all" | null;

export type ClipAgentDecision = {
  mode: ClipAgentMode;
  quantity: ClipAgentQuantity;
  focus: string;
  reply: string;
};

export type ClipAgentIntentV1 = {
  v: typeof CLIP_AGENT_INTENT_VERSION;
  mode: "best" | "theme";
  quantity: number | "all";
  focus: string;
};

const MODES = new Set<ClipAgentMode>([
  "best",
  "theme",
  "overview",
  "clarify",
  "off_topic",
]);

const JAILBREAK = [
  /ignore\s+(all\s+)?(previous|above|prior)\s+(instructions|prompts)/i,
  /oublie\s+(tes|les|toutes?\s+tes)\s+(instructions|règles|consignes)/i,
  /ignore\s+(tes|les)\s+instructions/i,
  /you\s+are\s+now\b/i,
  /tu\s+es\s+maintenant\b/i,
  /\bDAN\b/,
  /developer\s+mode/i,
  /jailbreak/i,
  /reveal\s+(your\s+)?(system\s+)?prompt/i,
  /show\s+(me\s+)?(the\s+)?system\s+prompt/i,
  /affiche\s+(moi\s+)?(le\s+)?(system\s+)?prompt/i,
  /nouveau\s+prompt\s+syst[eè]me/i,
];

const VIDEO_SHELL =
  /^(la |cette |toute la |the |this |whole )?(video|vod|stream)$/;

const BEST_ONE = [
  /\ble moment le plus (marquant|fort|viral|punchy|beau|intense|saillant)\b/,
  /\ble passage le plus (marquant|fort|viral|punchy)\b/,
  /\ble meilleur (moment|passage|extrait|clip|highlight)\b/,
  /\bc[' ]?est quoi le (meilleur |plus viral )?moment\b/,
  /\bwhat('?s| is) the (best |most viral )?moment\b/,
  /\bun seul (moment|passage|extrait|clip)\b/,
  /\bseulement (le meilleur|un|le plus fort)\b/,
  /\bjust(e)? (the )?(best|one) (moment|passage|clip|highlight)\b/,
  /\bonly (the )?(best |one )?(moment|passage|clip|highlight)\b/,
  /\bthe (best|most (striking|impactful|viral|memorable|powerful)) (moment|passage|clip|highlight)\b/,
  /\bthe most viral moment\b/,
  /\bthe highlight\b/,
  /\bthe peak\b/,
];

const WORD_TO_N: Record<string, number> = {
  un: 1,
  une: 1,
  one: 1,
  deux: 2,
  two: 2,
  trois: 3,
  three: 3,
  quatre: 4,
  four: 4,
  cinq: 5,
  five: 5,
  six: 6,
  sept: 7,
  seven: 7,
  huit: 8,
  eight: 8,
};

const QUANTITY_WORD = Object.keys(WORD_TO_N)
  .sort((a, b) => b.length - a.length)
  .join("|");

const CLIP_UNIT =
  "(meilleurs?\\s+)?(moments?|passages?|extraits?|clips?|highlights?|pics?)";

const BEST_ALL = [
  /\btous les (meilleurs )?(moments|passages|extraits|clips|pics|highlights)\b/,
  /\bles meilleurs moments\b/,
  /\bles moments? les plus (viraux|forts|marquants|punchy)\b/,
  /\ball the (best )?(moments|passages|clips|highlights)\b/,
  /\bthe best moments\b/,
  /\bthe highlights\b/,
  /\ball (of )?(the )?highlights\b/,
];

const QUANTITY_ALL_ONLY =
  /^(tous|toutes|all|all of them|tous les|plutot tous|non plutot tous|non tous|no all of them)$/;

const QUANTITY_ONE_ONLY =
  /^(le meilleur|un seul|un|seulement( le meilleur)?|just one|only one|the best( one)?|juste un)$/;

const CONFIRM_ONLY =
  /^(oui|ouais|ok|okay|yes|yep|yeah|vas-y|go|go ahead|c'est bon|c est bon|ok go)$/;

const VAGUE_CLIP =
  /^(fais( moi)? (des |les )?clips?|clippe|clips?|make clips?|do clips?|whatever|peu importe)$/;

const CLIP_SEEK =
  /\b(passage|moment|extrait|clip|highlight|quand (il|elle|on)|when (he|she|they)|where (he|she|they)|parle de|talks? about)\b/;

export function foldAsk(q: string): string {
  return String(q || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[’']/g, "'")
    .replace(/[?!.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isMomentRankingAsk(n: string): boolean {
  return (
    hasRankingOne(n) ||
    hasRankingAll(n) ||
    parseNumberedQuantity(n) != null ||
    /\b(le moment|un moment|the moment|the highlight|moment le plus viral)\b/.test(
      n
    )
  );
}

export function isOverviewQuery(q: string): boolean {
  const raw = String(q || "").trim();
  if (!raw) return false;
  const n = foldAsk(raw);
  if (isMomentRankingAsk(n)) return false;
  if (
    /de quoi\b.{0,48}\b(parle|agit)|c['’ ]?est quoi\b.{0,32}(sujet|video|vod|theme)|ca parle.{0,16}(de quoi|la video|cette video)|\b(le sujet|theme principal|resume|synthese)\b|explique(-moi)? (la |cette )?(video|vod)/.test(
      n
    )
  ) {
    return true;
  }
  if (/what('?s| is).{0,24}\babout\b|what does.{0,24}\btalk\b|summar/.test(n)) {
    return true;
  }
  return false;
}

export function isClipOffTopicAsk(q: string): boolean {
  const t = String(q || "").trim();
  if (!t) return false;
  if (JAILBREAK.some((r) => r.test(t))) return true;
  const n = foldAsk(t);
  if (CLIP_SEEK.test(n)) return false;
  if (
    /```(?:python|javascript|typescript|js|ts|bash|sh|sql|html|css)\b/i.test(t)
  ) {
    return true;
  }
  return /\b(ecris|genere|donne[- ]moi|cree|produis|write|generate|give me|create)\b.{0,80}\b(python|javascript|typescript|java\b|c\+\+|golang|dockerfile|sql|html|css|code|script|recette|recipe)\b/.test(
    n
  );
}

function hasRankingOne(n: string): boolean {
  return BEST_ONE.some((r) => r.test(n));
}

function hasRankingAll(n: string): boolean {
  return BEST_ALL.some((r) => r.test(n));
}

function cleanFocus(raw: string): string {
  return raw
    .replace(/^(le |la |les |l |the |a |an |du |des |de |d )/g, "")
    .replace(/\b(de |d |la |cette )?(video|vod|stream)$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function clipFocusTail(raw: string): string {
  return cleanFocus(
    raw
      .replace(
        /\b(dans|in) (la |cette |the |this )?(video|vod|stream)\b[\s\S]*$/g,
        ""
      )
      .replace(/\s*[.!?].*$/, "")
  );
}

function after(n: string, re: RegExp): string {
  const m = n.match(re);
  return m?.[1] ? clipFocusTail(m[1]) : "";
}

export function extractThemeFocus(q: string): string {
  const n = foldAsk(q);
  const candidates = [
    after(
      n,
      /\b(?:passages?|moments?|extraits?|clips?|angles?)\b(?:\s+\S+){0,4}\s+(?:sur|about|on|autour de)\s+(.+)$/
    ),
    after(n, /\b(?:parle(?:nt)?|parlant)\s+de\s+(.+)$/),
    after(n, /\btalks?\s+about\s+(.+)$/),
    after(n, /\bquand (?:il|elle|on)\s+(?:parle de\s+)?(.+)$/),
    after(n, /\bwhen (?:he|she|they)\s+(?:talks? about\s+)?(.+)$/),
    after(n, /\b(?:sur|about)\s+(.+)$/),
  ];
  for (const c of candidates) {
    if (c && !VIDEO_SHELL.test(c) && !hasRankingOne(c) && !hasRankingAll(c)) {
      return c;
    }
  }
  if (hasRankingOne(n) || hasRankingAll(n) || isOverviewQuery(n)) return "";
  const leftover = cleanFocus(
    n
      .replace(
        /^(donne[- ]moi|trouve(?:[- ]moi)?|cherche|montre[- ]moi|sort(?:[- ]moi)?|fais|je veux|i want|give me|find|show me|pull(?: out)?|get)\s+/g,
        ""
      )
      .replace(
        /\b(tous les|all the|les|the|le|la)\s+(meilleurs?\s+)?(moments?|passages?|extraits?|clips?|highlights?)\b/g,
        " "
      )
      .replace(/\b(moment|passage|extrait|clip|highlight)s?\b/g, " ")
      .replace(
        new RegExp(`\\b(${QUANTITY_WORD}|[1-8])\\b`, "g"),
        " "
      )
      .replace(
        /\b(marquant|viral|punchy|meilleurs?|best|striking|impactful|interessants?|interesting)\b/g,
        " "
      )
      .replace(/\b(plus|most|the|le|la|les|un|une|a|an|de|du|des|d)\b/g, " ")
  );
  if (leftover.length >= 3 && !VIDEO_SHELL.test(leftover)) return leftover;
  return "";
}

export function parseNumberedQuantity(q: string): number | null {
  const n = foldAsk(q);
  if (!n) return null;
  const unitRe = new RegExp(
    `\\b(${QUANTITY_WORD}|[1-8])\\s+${CLIP_UNIT}\\b`
  );
  const topRe = new RegExp(`\\b(?:top|les)\\s+(${QUANTITY_WORD}|[1-8])\\b`);
  const bareRe = new RegExp(`^(${QUANTITY_WORD}|[1-8])$`);
  const m = n.match(unitRe) || n.match(topRe) || n.match(bareRe);
  if (!m) return null;
  const token = m[1];
  const num = WORD_TO_N[token] ?? Number(token);
  if (!Number.isFinite(num) || num < 1 || num > 8) return null;
  return Math.floor(num);
}

export function inferAskQuantity(q: string): ClipAgentQuantity {
  const n = foldAsk(q);
  if (hasRankingAll(n) || QUANTITY_ALL_ONLY.test(n) || /\btous les\b|\ball the\b|\btout(s)? (ceux|celles)\b/.test(n)) {
    return "all";
  }
  const numbered = parseNumberedQuantity(n);
  if (numbered != null) return numbered;
  if (hasRankingOne(n) || QUANTITY_ONE_ONLY.test(n) || /\bun seul\b|\bonly one\b/.test(n)) {
    return 1;
  }
  return null;
}

export function isGlobalRankingAsk(q: string): boolean {
  const n = foldAsk(q);
  if (!n) return false;
  if (extractThemeFocus(n)) return false;
  return (
    hasRankingOne(n) ||
    hasRankingAll(n) ||
    parseNumberedQuantity(n) != null
  );
}

function isBareQuantityFollowUp(n: string): boolean {
  if (!n) return false;
  if (QUANTITY_ALL_ONLY.test(n) || QUANTITY_ONE_ONLY.test(n)) return true;
  if (parseNumberedQuantity(n) == null) return false;
  return new RegExp(
    `^(?:(?:les|top)\\s+)?(${QUANTITY_WORD}|[1-8])(?:\\s+${CLIP_UNIT})?$`
  ).test(n);
}

function canned(
  locale: SupportLocale,
  fr: string,
  en: string
): string {
  return locale === "en" ? en : fr;
}

function countReply(
  locale: SupportLocale,
  quantity: ClipAgentQuantity,
  themed: boolean
): string {
  if (quantity === 1) {
    return themed
      ? canned(
          locale,
          "Je prends le meilleur passage sur ça.",
          "I’ll take the strongest passage on that."
        )
      : canned(
          locale,
          "Je prends le moment le plus marquant.",
          "I’ll take the single strongest moment."
        );
  }
  if (typeof quantity === "number") {
    return themed
      ? canned(
          locale,
          `Je sors les ${quantity} passages qui collent le mieux.`,
          `I’ll pull the ${quantity} strongest matching passages.`
        )
      : canned(
          locale,
          `Je sors les ${quantity} moments les plus forts.`,
          `I’ll pull the ${quantity} strongest moments.`
        );
  }
  if (quantity === "all") {
    return themed
      ? canned(
          locale,
          "Je sors tous les passages qui collent.",
          "I’ll pull every matching passage."
        )
      : canned(
          locale,
          "Je sors tous les moments qui clipent vraiment.",
          "I’ll pull every moment that actually clips."
        );
  }
  return canned(
    locale,
    "Je te propose les angles qui clipent — tu coches ceux que tu veux.",
    "Here are the angles that clip — pick the ones you want."
  );
}

function withReply(
  decision: Omit<ClipAgentDecision, "reply">,
  locale: SupportLocale
): ClipAgentDecision {
  const reply =
    decision.mode === "off_topic"
      ? canned(
          locale,
          "Je sors des extraits de cette vidéo, je n’écris pas de code. Dis-moi un moment ou un thème à clipper.",
          "I’m here to pull clips from this video, not write code. Tell me a moment or a theme to cut."
        )
      : decision.mode === "clarify"
        ? canned(
            locale,
            "Tu veux le moment le plus fort, tous les pics, ou un thème précis ?",
            "Do you want the strongest moment, every highlight, or a specific theme?"
          )
        : decision.mode === "best" || decision.mode === "theme"
          ? countReply(locale, decision.quantity, decision.mode === "theme")
          : canned(
              locale,
              "C’est noté. Je creuse dès que c’est prêt.",
              "Got it. I’ll dig as soon as it’s ready."
            );
  return { ...decision, reply };
}

function actionableMode(
  previous: ClipAgentDecision | null
): "best" | "theme" | null {
  if (!previous) return null;
  return previous.mode === "best" || previous.mode === "theme"
    ? previous.mode
    : null;
}

export function classifyExplicitClipAsk(
  message: string,
  previous: ClipAgentDecision | null = null,
  locale: SupportLocale = "fr"
): ClipAgentDecision | null {
  const raw = String(message || "").trim();
  if (!raw) return null;
  const n = foldAsk(raw);

  if (isClipOffTopicAsk(raw)) {
    return withReply(
      { mode: "off_topic", quantity: null, focus: "" },
      locale
    );
  }

  if (isOverviewQuery(raw)) {
    return withReply(
      { mode: "overview", quantity: null, focus: "" },
      locale
    );
  }

  if (previous && isBareQuantityFollowUp(n)) {
    const mode = actionableMode(previous) ?? "best";
    const quantity = inferAskQuantity(n) ?? previous.quantity;
    return withReply(
      { mode, quantity, focus: previous.focus },
      locale
    );
  }

  if (previous && CONFIRM_ONLY.test(n) && actionableMode(previous)) {
    return {
      mode: previous.mode,
      quantity: previous.quantity,
      focus: previous.focus,
      reply: previous.reply,
    };
  }

  if (VAGUE_CLIP.test(n)) {
    if (actionableMode(previous)) {
      return {
        mode: previous!.mode,
        quantity: previous!.quantity,
        focus: previous!.focus,
        reply: previous!.reply,
      };
    }
    return withReply(
      { mode: "clarify", quantity: null, focus: "" },
      locale
    );
  }

  const focus = extractThemeFocus(raw);
  const quantity = inferAskQuantity(raw);
  const rankingOne = hasRankingOne(n);
  const rankingAll = hasRankingAll(n);

  if (focus && rankingAll) {
    return withReply({ mode: "theme", quantity: "all", focus }, locale);
  }
  if (focus && (rankingOne || quantity === 1) && !rankingAll) {
    return withReply({ mode: "theme", quantity: 1, focus }, locale);
  }
  if (focus && typeof quantity === "number") {
    return withReply({ mode: "theme", quantity, focus }, locale);
  }
  if (focus && quantity === "all") {
    return withReply({ mode: "theme", quantity: "all", focus }, locale);
  }
  if (focus) {
    return withReply({ mode: "theme", quantity: null, focus }, locale);
  }
  if (rankingAll || quantity === "all") {
    return withReply({ mode: "best", quantity: "all", focus: "" }, locale);
  }
  if (rankingOne || quantity === 1) {
    return withReply({ mode: "best", quantity: 1, focus: "" }, locale);
  }
  if (typeof quantity === "number") {
    return withReply({ mode: "best", quantity, focus: "" }, locale);
  }
  return null;
}

export function isGlobalRankingDecision(d: ClipAgentDecision | null): boolean {
  return Boolean(d && d.mode === "best" && !d.focus.trim());
}

export function decisionMutatesTopics(d: ClipAgentDecision | null): boolean {
  return Boolean(d && (d.mode === "best" || d.mode === "theme"));
}

export function topicsCap(quantity: ClipAgentQuantity): number {
  if (typeof quantity === "number" && quantity >= 1) {
    return Math.max(1, Math.min(8, Math.floor(quantity)));
  }
  return 8;
}

export function parseMode(raw: unknown): ClipAgentMode | null {
  if (raw === "best_one") return "best";
  if (raw === "best_many") return "best";
  if (typeof raw !== "string") return null;
  return MODES.has(raw as ClipAgentMode) ? (raw as ClipAgentMode) : null;
}

export function parseQuantity(raw: unknown): ClipAgentQuantity {
  if (raw === "all") return "all";
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 8) {
    return raw;
  }
  if (typeof raw === "string" && /^[1-8]$/.test(raw)) return Number(raw);
  return null;
}

export function coerceDecision(raw: unknown): ClipAgentDecision | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const mode = parseMode(rec.mode);
  if (!mode) return null;
  return {
    mode,
    quantity: parseQuantity(rec.quantity),
    focus: typeof rec.focus === "string" ? rec.focus.trim().slice(0, 200) : "",
    reply: typeof rec.reply === "string" ? rec.reply.trim().slice(0, 1200) : "",
  };
}

export function mergeClipDecision(
  previous: ClipAgentDecision | null,
  next: ClipAgentDecision
): ClipAgentDecision {
  if (
    next.mode === "off_topic" ||
    next.mode === "overview" ||
    next.mode === "clarify"
  ) {
    return next;
  }
  const inheritedFocus = !next.focus.trim() && Boolean(previous?.focus?.trim());
  const focus = next.focus.trim() || previous?.focus?.trim() || "";
  let quantity = next.quantity;
  if (quantity == null && inheritedFocus) {
    quantity = previous?.quantity ?? null;
  }
  let mode = next.mode;
  if (mode === "best" && focus && previous?.mode === "theme" && !next.focus.trim()) {
    mode = "theme";
  }
  return {
    mode,
    quantity,
    focus,
    reply: next.reply,
  };
}

export function parseAgentDecision(
  raw: Record<string, unknown> | null,
  fallback: {
    message: string;
    previous: ClipAgentDecision | null;
    locale: SupportLocale;
  }
): ClipAgentDecision {
  const explicit = classifyExplicitClipAsk(
    fallback.message,
    fallback.previous,
    fallback.locale
  );
  const fromLlm: ClipAgentDecision = {
    mode: parseMode(raw?.mode) ?? explicit?.mode ?? "theme",
    quantity: parseQuantity(raw?.quantity) ?? explicit?.quantity ?? null,
    focus:
      typeof raw?.focus === "string" && raw.focus.trim()
        ? raw.focus.trim().slice(0, 200)
        : explicit?.focus || "",
    reply:
      typeof raw?.reply === "string" && raw.reply.trim()
        ? raw.reply.trim().slice(0, 1200)
        : explicit?.reply ||
          (fallback.locale === "en"
            ? "Tell me a moment or a theme to pull out."
            : "Dis-moi un moment ou un thème à extraire."),
  };
  const merged = mergeClipDecision(fallback.previous, explicit ?? fromLlm);
  if (explicit && decisionMutatesTopics(explicit)) {
    return {
      ...merged,
      mode: explicit.mode,
      quantity: explicit.quantity ?? merged.quantity,
      focus:
        explicit.mode === "best" && !explicit.focus
          ? ""
          : explicit.focus || merged.focus,
      reply: fromLlm.reply || explicit.reply,
    };
  }
  if (explicit && explicit.mode !== "theme" && explicit.mode !== "best") {
    return {
      ...explicit,
      reply: fromLlm.reply || explicit.reply,
    };
  }
  return mergeClipDecision(fallback.previous, fromLlm);
}

export function serializeAgentIntent(
  decision: ClipAgentDecision,
  focusOverride?: string
): string {
  if (decision.mode !== "best" && decision.mode !== "theme") return "";
  const q = decision.quantity;
  const quantity: number | "all" =
    q === "all"
      ? "all"
      : typeof q === "number" && q >= 1
        ? Math.max(1, Math.min(8, Math.floor(q)))
        : "all";
  const focus = (focusOverride ?? decision.focus).trim().slice(0, 200);
  const payload: ClipAgentIntentV1 = {
    v: CLIP_AGENT_INTENT_VERSION,
    mode: decision.mode,
    quantity,
    focus,
  };
  return JSON.stringify(payload);
}

export function parseAgentIntentContract(
  raw: unknown
): ClipAgentIntentV1 | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return normalizeIntentV1(raw as Record<string, unknown>);
  }
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  if (s.startsWith("{")) {
    try {
      const parsed = JSON.parse(s) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const contract = normalizeIntentV1(parsed as Record<string, unknown>);
        if (contract) return contract;
      }
    } catch {
      /* legacy sentence */
    }
  }
  return {
    v: CLIP_AGENT_INTENT_VERSION,
    mode: "theme",
    quantity: "all",
    focus: s.slice(0, 200),
  };
}

function normalizeIntentV1(
  rec: Record<string, unknown>
): ClipAgentIntentV1 | null {
  if (rec.v !== 1 && rec.v !== "1") return null;
  const mode = rec.mode === "best" || rec.mode === "theme" ? rec.mode : null;
  if (!mode) return null;
  return {
    v: CLIP_AGENT_INTENT_VERSION,
    mode,
    quantity: parseQuantity(rec.quantity) ?? "all",
    focus: typeof rec.focus === "string" ? rec.focus.trim().slice(0, 200) : "",
  };
}

export function requestedMomentsMax(
  contract: ClipAgentIntentV1 | null,
  momentsMax: number
): number {
  const cap = Math.max(1, Math.floor(Number(momentsMax) || 1));
  const q = contract?.quantity;
  if (typeof q === "number" && q >= 1) return Math.min(q, cap);
  return cap;
}

export function pendingListenReply(locale: SupportLocale): string {
  return locale === "en"
    ? "Got it. I’ll pull that as soon as I’ve heard the video."
    : "C’est noté. Je sors ça dès que j’ai fini d’écouter.";
}

export function transcriptMissingReply(locale: SupportLocale): string {
  return locale === "en"
    ? "I finished listening but I still don’t have the transcript. Retry the analysis — or take the best moments anyway."
    : "J’ai fini d’écouter mais je n’ai toujours pas le texte. Relance l’analyse — ou prends les meilleurs moments.";
}
