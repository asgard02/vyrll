type Bucket = { count: number; resetAt: number };

const hits = new Map<string, Bucket>();

export function isUserRateLimited(
  userId: string,
  bucket: string,
  max: number,
  windowMs: number
): boolean {
  const key = `${bucket}:${userId}`;
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || now >= entry.resetAt) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  if (entry.count >= max) return true;
  entry.count += 1;
  return false;
}

export const AGENT_CHAT_LIMIT = { max: 50, windowMs: 15 * 60 * 1000 };
export const AGENT_TOPICS_LIMIT = { max: 40, windowMs: 15 * 60 * 1000 };
export const AGENT_ANALYZE_LIMIT = { max: 8, windowMs: 60 * 60 * 1000 };
