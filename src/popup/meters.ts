// Pure meter/trend helpers for the popup insights card. Inputs are raw
// storage/provider JSON (usage days, quota items, codex cards) — boundary
// `any`, read defensively via asNumber().

export interface Meter {
  label: string;
  pct: number | null;
  detail?: string;
  reset?: string;
  title?: string;
  color: string;
  alwaysShow?: boolean;
  quota?: boolean;
  fullAvailable?: boolean;
  requiresRecentDelta?: boolean;
  changedWithin24h?: boolean;
}

export function visibleUsageMeters(items: Meter[], fallback?: Meter): Meter[] {
  const shouldShowMeter = (m: Meter) => !m.requiresRecentDelta || m.changedWithin24h;
  const pctMeters = items.filter((m) => m.pct != null);
  const activePctMeters = pctMeters.filter((m) => (m.pct ?? 0) > 0);
  const detailMeters = items.filter((m) => m.pct == null && shouldShowMeter(m) && (m.alwaysShow || m.detail));
  const visibleMeters = [...activePctMeters, ...detailMeters];
  return visibleMeters.length > 0 ? visibleMeters : (fallback ? [fallback] : []);
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

const RESET_FIELDS = [
  "resetsAt", "resets_at", "resetAt", "reset_at", "resetAfter", "reset_after",
  "resetAfterSeconds", "reset_after_seconds", "resetTime", "reset_time",
  "resetDate", "reset_date", "nextResetAt", "next_reset_at",
];

export const METRIC_CHANGE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function metricChangedRecently(usage: any, key: string): boolean {
  const changedAt = asNumber(usage?.metricChanges?.[key]?.changedAt);
  return changedAt != null && Date.now() - changedAt <= METRIC_CHANGE_WINDOW_MS;
}

export function anyMetricChangedRecently(usage: any, keys: string[]): boolean {
  return keys.some((key) => metricChangedRecently(usage, key));
}

function resetValue(item: any): unknown {
  if (!item || typeof item !== "object") return null;
  for (const field of RESET_FIELDS) {
    if (item[field] != null && item[field] !== "") return item[field];
  }
  return null;
}

function parseDurationMs(value: string): number | null {
  const text = value.trim().toLowerCase();
  if (!text) return null;
  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric >= 0) return numeric * 1000;

  let total = 0;
  let matched = false;
  const re = /(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)/g;
  for (const match of text.matchAll(re)) {
    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) continue;
    matched = true;
    const unit = match[2];
    if (unit.startsWith("ms")) total += amount;
    else if (unit.startsWith("s")) total += amount * 1000;
    else if (unit.startsWith("m")) total += amount * 60 * 1000;
    else if (unit.startsWith("h")) total += amount * 60 * 60 * 1000;
    else if (unit.startsWith("d")) total += amount * 24 * 60 * 60 * 1000;
  }
  return matched ? total : null;
}

function parseResetDate(value: unknown, now: number): Date | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    if (value > 1_000_000_000_000) return new Date(value);
    if (value > 1_000_000_000) return new Date(value * 1000);
    return new Date(now + value * 1000);
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric >= 0) {
    if (numeric > 1_000_000_000_000) return new Date(numeric);
    if (numeric > 1_000_000_000) return new Date(numeric * 1000);
    return new Date(now + numeric * 1000);
  }
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) return new Date(parsed);
  const duration = parseDurationMs(text);
  return duration == null ? null : new Date(now + duration);
}

function formatResetCountdown(reset: Date, now: number): string {
  const ms = reset.getTime() - now;
  if (!Number.isFinite(ms)) return "";
  if (ms <= 0) return "resets now";
  if (ms < 60 * 1000) return "resets <1m";
  const minutes = Math.ceil(ms / (60 * 1000));
  if (minutes < 60) return `resets ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return remainingMinutes ? `resets ${hours}h ${remainingMinutes}m` : `resets ${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours ? `resets ${days}d ${remainingHours}h` : `resets ${days}d`;
}

export function resetDetail(item: any, now = Date.now()): { text: string; title: string } | null {
  const reset = parseResetDate(resetValue(item), now);
  if (!reset) return null;
  const text = formatResetCountdown(reset, now);
  if (!text) return null;
  return {
    text,
    title: `Resets at ${reset.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`,
  };
}

export function detailWithReset(base: string, item: any): { detail: string; reset?: string; title?: string } {
  const reset = resetDetail(item);
  return reset ? { detail: base, reset: reset.text, title: reset.title } : { detail: base };
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
      ...detailWithReset(`${pct}%`, item),
      color,
      alwaysShow: true,
      quota: true,
      fullAvailable: pct <= 0 && actualUsed <= 0,
    });
    return;
  }
  if (remaining != null) {
    target.push({ label, pct: null, ...detailWithReset(`${remaining} left`, item), color, alwaysShow: true, requiresRecentDelta, changedWithin24h });
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
    ...detailWithReset(`${Math.round(pct)}%`, card),
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
