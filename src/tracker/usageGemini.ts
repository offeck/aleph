// Gemini quota parsing. This module owns the pure parse of the qpEbW RPC's
// decoded payload, used by the background provider-usage fetcher
// (src/background/providerUsage.ts) — which owns the session-token extraction
// and network call now that limits refresh in the background.

// qpEbW row schema (verified 2026-06 by replaying the app's own calls):
// [featureDescriptor, poolType, ?, [resetSec, resetNanos], limit, remaining]
// Current accounts report ONE account-wide daily credit pool — with our "[]"
// payload its featureDescriptor is empty. Premium usage drains the pool
// (measured: Pro message ≈ 19 credits, Flash-Lite message 0); per-feature
// rows ([null, featureId]) are a legacy shape kept as a fallback.
const GEMINI_FEATURE_NAMES: Record<number, string> = {
  4: "Pro 3.1", 15: "Thinking", 25: "Chat", 7: "Flash",
  13: "Extended", 16: "Agent", 9: "Images", 21: "Image Edit",
  17: "Music 30s", 24: "Screen", 26: "Audio", 14: "Slides",
  19: "Music Full", 8: "Notebook", 11: "Live",
  3: "Video Pro", 18: "Video", 5: "Video Lite", 12: "Ultra Only",
};

export interface GeminiFeature {
  id: number;
  name: string;
  limit: number;
  remaining: number;
  resetsAt: string | null;
}

export interface GeminiCredits {
  limit: number;
  remaining: number;
  used: number;
  resetsAt: string | null;
}

// Pure parse of the decoded qpEbW payload — exported for unit tests.
// The payload is raw provider JSON (nested arrays), hence the `any` boundary.
export function parseGeminiQuotas(quotas: any): { credits: GeminiCredits | null; features: GeminiFeature[] } {
  const features: GeminiFeature[] = [];
  let credits: GeminiCredits | null = null;
  if (!Array.isArray(quotas) || !Array.isArray(quotas[0])) return { credits, features };
  for (const q of quotas[0]) {
    if (!Array.isArray(q) || q.length < 6) continue;
    const featureId = q[0]?.[1];
    const resetTs = q[3]?.[0];
    const limit = q[4];
    const remaining = q[5];
    if (typeof limit !== "number" || typeof remaining !== "number") continue;
    if (limit === 0) continue;
    const resetsAt = resetTs ? new Date(resetTs * 1000).toISOString() : null;
    if (featureId == null) {
      credits = { limit, remaining, used: Math.max(0, limit - remaining), resetsAt };
      continue;
    }
    features.push({
      id: featureId,
      name: GEMINI_FEATURE_NAMES[featureId] || "Feature " + featureId,
      limit, remaining,
      resetsAt,
    });
  }
  features.sort((a, b) => b.limit - a.limit);
  return { credits, features };
}
