import {
  CHATGPT_CODEX_CREDITS_KEY,
  CHATGPT_CODEX_WORKSPACE_CREDITS_KEY,
  CHATGPT_CODEX_WORKSPACE_THREADS_KEY,
  CHATGPT_CODEX_WORKSPACE_TURNS_KEY,
  chatgptLimitMetricKey,
  chatgptModelMetricKey,
  GEMINI_CREDITS_KEY,
  GEMINI_ANTIGRAVITY_CREDITS_KEY,
  geminiAntigravityModelMetricKey,
  geminiFeatureMetricKey,
} from "../shared/metricKeys";

// ── Provider usage metric change tracking ────────────────
export const USAGE_METRIC_CHANGE_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface MetricChange {
  changedAt: number;
  previous?: number;
  current: number;
}

function metricNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function addUsageMetricValue(values: Record<string, number>, key: string, value: unknown) {
  const n = metricNumber(value);
  if (key && n != null) values[key] = n;
}

// Provider usage snapshots are raw JSON persisted from tracker messages —
// boundary `any`, traversed defensively with optional chains throughout.
function collectCodexWorkspaceMetricValues(values: Record<string, number>, data: any) {
  const rows = Array.isArray(data?.data) ? data.data : [];
  let threads = 0, turns = 0, credits = 0;
  for (const row of rows) {
    threads += metricNumber(row?.totals?.threads) || 0;
    turns += metricNumber(row?.totals?.turns) || 0;
    credits += metricNumber(row?.totals?.credits) || 0;
  }
  if (threads || turns || credits) {
    addUsageMetricValue(values, CHATGPT_CODEX_WORKSPACE_THREADS_KEY, threads);
    addUsageMetricValue(values, CHATGPT_CODEX_WORKSPACE_TURNS_KEY, turns);
    addUsageMetricValue(values, CHATGPT_CODEX_WORKSPACE_CREDITS_KEY, credits);
  }
}

export function collectUsageMetricValues(platform: string, usage: any): Record<string, number> {
  const values: Record<string, number> = {};
  if (!usage || typeof usage !== "object") return values;

  if (platform === "chatgpt") {
    const chat = usage.chat || usage;
    // Metric key builders live in shared/metricKeys.ts.
    for (const ml of (chat?.modelLimits || [])) {
      const id = ml?.model || ml?.name || ml?.feature;
      if (id != null) addUsageMetricValue(values, chatgptModelMetricKey(id), ml?.remaining ?? ml?.used);
    }
    for (const lp of (chat?.limits || [])) {
      const id = lp?.feature || lp?.name;
      if (id != null) addUsageMetricValue(values, chatgptLimitMetricKey(id), lp?.remaining ?? lp?.used);
    }
    const analytics = usage.codex?.analytics;
    addUsageMetricValue(values, CHATGPT_CODEX_CREDITS_KEY, analytics?.credits?.remaining);
    collectCodexWorkspaceMetricValues(values, analytics?.dailyWorkspaceUsage);
  }

  if (platform === "gemini") {
    addUsageMetricValue(values, GEMINI_CREDITS_KEY, usage.credits?.remaining);
    for (const feature of (usage.features || [])) {
      if (feature?.id != null) addUsageMetricValue(values, geminiFeatureMetricKey(feature.id), feature?.remaining ?? feature?.used);
    }
    const antigravity = usage.antigravity;
    addUsageMetricValue(values, GEMINI_ANTIGRAVITY_CREDITS_KEY, antigravity?.credits?.remaining);
    for (const model of (antigravity?.models || [])) {
      if (model?.id != null) addUsageMetricValue(values, geminiAntigravityModelMetricKey(model.id), model?.remaining ?? model?.used);
    }
  }

  return values;
}

export function updateUsageMetricChanges(platform: string, previous: any, nextUsage: any): { metricValues: Record<string, number>; metricChanges: Record<string, MetricChange> } {
  const now = Date.now();
  const previousValues: Record<string, number> = previous?.metricValues || collectUsageMetricValues(platform, previous);
  const previousChanges: Record<string, MetricChange> = previous?.metricChanges || {};
  const nextValues = collectUsageMetricValues(platform, nextUsage);
  const nextChanges: Record<string, MetricChange> = {};

  for (const [key, value] of Object.entries(nextValues)) {
    const hadPrevious = Object.prototype.hasOwnProperty.call(previousValues, key);
    const previousValue = previousValues[key];
    const changed = hadPrevious && Math.abs(value - previousValue) > 1e-9;
    const previousChangedAt = metricNumber(previousChanges[key]?.changedAt);
    const changedAt = changed ? now : previousChangedAt;
    if (changedAt && now - changedAt <= USAGE_METRIC_CHANGE_WINDOW_MS) {
      nextChanges[key] = {
        changedAt,
        previous: changed ? previousValue : previousChanges[key]?.previous,
        current: value,
      };
    }
  }

  return { metricValues: nextValues, metricChanges: nextChanges };
}
