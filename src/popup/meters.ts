// Pure meter/trend helpers for the popup insights card. Inputs are raw
// storage/provider JSON (usage days, quota items, codex cards) — boundary
// `any`, read defensively via asNumber().

export interface Meter {
  label: string;
  pct: number | null;
  detail?: string;
  color: string;
  alwaysShow?: boolean;
  quota?: boolean;
  fullAvailable?: boolean;
  requiresRecentDelta?: boolean;
  changedWithin24h?: boolean;
}

export function estimatedTokenTotal(day: any): number {
  if (!day) return 0;
  return (day.tokensIn || 0) + (day.tokensOut || 0);
}

export function asNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function cleanLabel(value: unknown, fallback?: string): string {
  return String(value || fallback || "Usage").replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export const METRIC_CHANGE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function metricChangedRecently(usage: any, key: string): boolean {
  const changedAt = asNumber(usage?.metricChanges?.[key]?.changedAt);
  return changedAt != null && Date.now() - changedAt <= METRIC_CHANGE_WINDOW_MS;
}

export function anyMetricChangedRecently(usage: any, keys: string[]): boolean {
  return keys.some((key) => metricChangedRecently(usage, key));
}

export function addQuotaMeter(target: Meter[], label: string, item: any, color: string, options: { requiresRecentDelta?: boolean; changedWithin24h?: boolean } = {}) {
  const limit = asNumber(item?.limit);
  const remaining = asNumber(item?.remaining);
  const used = asNumber(item?.used);
  const requiresRecentDelta = !!options.requiresRecentDelta;
  const changedWithin24h = !!options.changedWithin24h;
  if (limit && limit > 0) {
    if (used == null && remaining == null) return;
    const actualUsed = used != null ? used : Math.max(0, limit - (remaining || 0));
    const pct = Math.min(100, Math.max(0, Math.round((actualUsed / limit) * 100)));
    target.push({
      label,
      pct,
      color,
      alwaysShow: true,
      quota: true,
      fullAvailable: pct <= 0 && actualUsed <= 0,
    });
    return;
  }
  if (remaining != null) {
    target.push({ label, pct: null, detail: `${remaining} left`, color, alwaysShow: true, requiresRecentDelta, changedWithin24h });
  }
}

export function shortCodexModelLabel(model: unknown): string {
  return String(model || "Codex")
    .replace(/^GPT[-\d.]*-/i, "")
    .replace(/^Codex-/i, "Codex ")
    .replace(/-/g, " ");
}

export function codexLimitLabel(card: any): string {
  const suffix = card?.period === "weekly" ? "7d" : (card?.period || "limit");
  if (card?.model) return `${shortCodexModelLabel(card.model)} ${suffix}`;
  return `Codex ${suffix}`;
}

export function addCodexLimitMeter(target: Meter[], card: any, color: string) {
  const remainingPct = asNumber(card?.remainingPct);
  const usedPct = asNumber(card?.usedPct);
  if (remainingPct == null && usedPct == null) return;
  const pct = usedPct != null ? usedPct : Math.max(0, Math.min(100, 100 - (remainingPct ?? 0)));
  const remaining = remainingPct != null ? remainingPct : Math.max(0, Math.min(100, 100 - pct));
  target.push({
    label: codexLimitLabel(card),
    pct: Math.round(pct),
    color,
    alwaysShow: true,
    quota: true,
    fullAvailable: pct <= 0 && remaining >= 100,
  });
}

export function sumCodexWorkspace(data: any): { threads: number; turns: number; credits: number } | null {
  const rows = Array.isArray(data?.data) ? data.data : [];
  const totals = { threads: 0, turns: 0, credits: 0 };
  for (const row of rows) {
    totals.threads += asNumber(row?.totals?.threads) || 0;
    totals.turns += asNumber(row?.totals?.turns) || 0;
    totals.credits += asNumber(row?.totals?.credits) || 0;
  }
  return totals.threads || totals.turns || totals.credits ? totals : null;
}

export function computeTrend(current: number, previous: number): { pct: number; dir: "up" | "down" | "flat" } {
  if (!previous || previous === 0) return { pct: 0, dir: "flat" };
  const pct = Math.round(((current - previous) / previous) * 100);
  return { pct, dir: pct > 5 ? "up" : pct < -5 ? "down" : "flat" };
}
