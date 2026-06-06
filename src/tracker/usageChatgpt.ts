import { dateDaysAgo, localDateString } from "../shared/dates";
import { send } from "./send";
import { getChatgptAccessToken, refreshChatgptToken } from "./plans";

// ── ChatGPT real usage polling ───────────────────────────
// Raw provider JSON is inherently untyped — `any` is confined to this fetch
// boundary; everything downstream narrows through the typed normalizers.
function fetchJson(url: string, options: RequestInit = {}): Promise<any> {
  return fetch(url, options)
    .then((r) => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
    .catch((e) => ({ __alephError: e?.message || String(e) }));
}

function normalizeChatgptLimit(lp: any) {
  return {
    feature: lp.feature_name || lp.feature || lp.name,
    remaining: lp.remaining,
    limit: lp.limit ?? lp.max ?? lp.total,
    used: lp.used ?? lp.consumed,
    resetsAt: lp.reset_after ?? lp.resets_at,
  };
}

function normalizeChatgptModelLimit(ml: any) {
  return {
    model: ml.model_slug || ml.model || ml.slug,
    remaining: ml.remaining,
    limit: ml.limit ?? ml.max ?? ml.total,
    used: ml.used ?? ml.consumed,
    resetsAt: ml.reset_after ?? ml.resets_at,
  };
}

function fetchChatgptChatUsage(token: string | null) {
  if (!token) return Promise.resolve({ limits: [], modelLimits: [], error: "missing access token" });
  const headers = { "Content-Type": "application/json", Authorization: "Bearer " + token };
  return fetchJson("/backend-api/conversation/init", {
    method: "POST", credentials: "same-origin", headers, body: "{}",
  }).then((data) => {
    if (data?.__alephError) return { limits: [], modelLimits: [], error: data.__alephError };
    const limits = Array.isArray(data?.limits_progress) ? data.limits_progress.map(normalizeChatgptLimit) : [];
    const modelLimits = Array.isArray(data?.model_limits) ? data.model_limits.map(normalizeChatgptModelLimit) : [];
    return { limits, modelLimits };
  });
}

interface CodexUsagePayload {
  errors?: Record<string, string>;
  [endpoint: string]: unknown;
}

let cachedCodexUsage: CodexUsagePayload | null = null;
let lastCodexUsagePoll = 0;
const CODEX_USAGE_POLL_MS = 5 * 60 * 1000;

function fetchCodexUsage(token: string | null): Promise<CodexUsagePayload> {
  const now = Date.now();
  if (cachedCodexUsage && (now - lastCodexUsagePoll) < CODEX_USAGE_POLL_MS) {
    return Promise.resolve(cachedCodexUsage);
  }

  const start = dateDaysAgo(29);
  const end = localDateString();
  const headers: HeadersInit = token ? { Authorization: "Bearer " + token } : {};
  const opts: RequestInit = { credentials: "same-origin", headers };
  const endpoints = {
    balance: "/backend-api/wham/usage",
    dailyTokenUsage: "/backend-api/wham/usage/daily-token-usage-breakdown?start_date=" + start + "&end_date=" + end + "&group_by=day",
    dailyWorkspaceUsage: "/backend-api/wham/analytics/daily-workspace-usage-counts?start_date=" + start + "&end_date=" + end + "&group_by=day&workspace_user=true",
    creditUsageEvents: "/backend-api/wham/usage/credit-usage-events",
  };

  return Promise.all(Object.entries(endpoints).map(([key, url]) => (
    fetchJson(url, opts).then((data) => [key, data] as [string, any])
  ))).then((entries) => {
    const errors: Record<string, string> = {};
    const codex: CodexUsagePayload = { errors };
    for (const [key, data] of entries) {
      if (data?.__alephError) errors[key] = data.__alephError;
      else codex[key] = data;
    }
    if (Object.keys(errors).length === 0) delete codex.errors;
    if (Object.keys(codex).some((key) => key !== "errors")) {
      cachedCodexUsage = codex;
      lastCodexUsagePoll = now;
    }
    return codex;
  });
}

function findFirstValue(obj: unknown, names: string[]): unknown {
  if (!obj || typeof obj !== "object") return null;
  const record = obj as Record<string, unknown>;
  for (const name of names) {
    if (record[name] != null) return record[name];
  }
  return null;
}

export function boundedPercent(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

export function boundedRatio(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n >= 0 && n <= 1 ? n * 100 : n));
}

function findFirstPercent(obj: unknown, names: string[]): number | null {
  return boundedPercent(findFirstValue(obj, names));
}

function findFirstRatio(obj: unknown, names: string[]): number | null {
  return boundedRatio(findFirstValue(obj, names));
}

function textFromValues(obj: unknown): string {
  if (!obj || typeof obj !== "object") return "";
  const record = obj as Record<string, unknown>;
  const keys = ["title", "label", "name", "displayName", "display_name", "limitName", "limit_name", "model", "modelSlug", "model_slug", "bucket", "period", "window", "limitType", "limit_type"];
  return keys.map((k) => record[k]).filter((v) => typeof v === "string").join(" ");
}

function codexContextModel(obj: unknown, fallback = ""): string {
  // Values practically come from string fields; cast (not String()) keeps the
  // original passthrough behavior byte-identical.
  return (findFirstValue(obj, [
    "model", "modelSlug", "model_slug", "modelName", "model_name", "displayModel", "display_model",
    "limitName", "limit_name", "title", "label", "name", "displayName", "display_name",
  ]) || fallback || "") as string;
}

export interface CodexLimit {
  type: "limit";
  title: string;
  period: string;
  model: string;
  remainingPct: number | null;
  usedPct: number | null;
  remaining: number | null;
  limit: number | null;
  resetsAt: string;
}

interface CodexContext {
  model?: string;
  text?: string;
  period?: string;
}

export function normalizeCodexLimit(obj: Record<string, unknown>, context?: CodexContext): CodexLimit | null {
  const text = (textFromValues(obj) + " " + (context?.text || "")).trim();
  if (!/(codex|agentic|usage|limit|quota|weekly|week|hour|5h|spark)/i.test(text + " " + Object.keys(obj).join(" "))) return null;

  const remainingPct = findFirstPercent(obj, [
    "remainingPct", "remaining_pct", "remainingPercent", "remaining_percent", "percentRemaining", "percent_remaining", "percentageRemaining", "percentage_remaining", "remainingPercentage", "remaining_percentage",
    "availablePercent", "available_percent", "remainingQuotaPercent", "remaining_quota_percent", "usageRemainingPercent", "usage_remaining_percent",
  ]) ?? findFirstRatio(obj, [
    "remainingRatio", "remaining_ratio", "fractionRemaining", "fraction_remaining", "remainingFraction", "remaining_fraction",
  ]);
  const usedPct = findFirstPercent(obj, [
    "usedPct", "used_pct", "usagePct", "usage_pct", "usedPercent", "used_percent", "usagePercent", "usage_percent", "percentageUsed", "percentage_used",
    "utilizationPct", "utilization_pct", "consumedPercent", "consumed_percent", "percentUsed", "percent_used",
  ]) ?? findFirstRatio(obj, [
    "usedRatio", "used_ratio", "usageRatio", "usage_ratio", "usedFraction", "used_fraction", "usageFraction", "usage_fraction", "utilization",
  ]);
  const remainingRaw = findFirstValue(obj, ["remaining", "remainingAmount", "remaining_amount", "remainingCredits", "remaining_credits", "available", "availableAmount", "available_amount"]);
  const usedRaw = findFirstValue(obj, ["used", "usedAmount", "used_amount", "current", "currentUsage", "current_usage", "consumed", "consumedAmount", "consumed_amount", "usedCredits", "used_credits"]);
  const limitRaw = findFirstValue(obj, ["limit", "limitAmount", "limit_amount", "max", "maximum", "total", "quota", "allowed", "allowedAmount", "allowed_amount"]);
  const remaining = remainingRaw != null ? Number(remainingRaw) : NaN;
  const used = usedRaw != null ? Number(usedRaw) : NaN;
  const limit = limitRaw != null ? Number(limitRaw) : NaN;
  const computedRemainingPct = Number.isFinite(remaining) && Number.isFinite(limit) && limit > 0 ? boundedPercent((remaining / limit) * 100) : null;
  const computedUsedPct = Number.isFinite(used) && Number.isFinite(limit) && limit > 0 ? boundedPercent((used / limit) * 100) : null;
  const normalizedRemainingPct = remainingPct ?? (usedPct != null ? boundedPercent(100 - usedPct) : (computedRemainingPct ?? (computedUsedPct != null ? boundedPercent(100 - computedUsedPct) : null)));
  const normalizedUsedPct = usedPct ?? computedUsedPct ?? (normalizedRemainingPct != null ? boundedPercent(100 - normalizedRemainingPct) : null);
  if (normalizedRemainingPct == null && normalizedUsedPct == null) return null;

  const periodText = text + " " + Object.entries(obj).map(([k, v]) => (typeof v === "string" ? k + " " + v : k)).join(" ");
  let period = /5\s*(?:hour|hr|h)|five[_ -]?hour|5h|pt5h/i.test(periodText) ? "5h" : (/weekly|week|7d|seven[_ -]?day|p7d/i.test(periodText) ? "weekly" : "");
  const windowSeconds = Number(findFirstValue(obj, ["windowSeconds", "window_seconds", "limitWindowSeconds", "limit_window_seconds", "durationSeconds", "duration_seconds", "periodSeconds", "period_seconds"]));
  const windowMinutes = Number(findFirstValue(obj, ["windowMinutes", "window_minutes", "durationMinutes", "duration_minutes", "periodMinutes", "period_minutes"]));
  if (!period && (windowSeconds === 18000 || windowMinutes === 300)) period = "5h";
  if (!period && (windowSeconds === 604800 || windowMinutes === 10080)) period = "weekly";
  if (!period && context?.period) period = context.period;
  if (!period) return null;

  const model = codexContextModel(obj, context?.model || "");
  return {
    type: "limit",
    title: (findFirstValue(obj, ["title", "label", "name", "displayName", "display_name"]) || "") as string,
    period,
    model: String(model || ""),
    remainingPct: normalizedRemainingPct,
    usedPct: normalizedUsedPct,
    remaining: Number.isFinite(remaining) ? remaining : (Number.isFinite(used) && Number.isFinite(limit) ? Math.max(0, limit - used) : null),
    limit: Number.isFinite(limit) ? limit : null,
    resetsAt: (findFirstValue(obj, ["resetsAt", "resets_at", "resetAt", "reset_at", "resetAfter", "reset_after", "resetAfterSeconds", "reset_after_seconds", "resetTime", "reset_time", "resetDate", "reset_date", "nextResetAt", "next_reset_at"]) || "") as string,
  };
}

function codexLimitKey(limit: CodexLimit) {
  return String(limit?.model || limit?.title || "shared").toLowerCase() + ":" + (limit?.period || "");
}

function addCodexLimit(out: CodexLimit[], limit: CodexLimit | null) {
  if (!limit) return;
  const key = codexLimitKey(limit);
  if (!out.some((item) => codexLimitKey(item) === key)) out.push(limit);
}

function collectCodexRateWindows(rateLimit: unknown, out: CodexLimit[], context: CodexContext = {}) {
  if (!rateLimit || typeof rateLimit !== "object") return;
  const record = rateLimit as Record<string, unknown>;
  const windows: Array<[string, string]> = [
    ["primary_window", "5h"],
    ["primaryWindow", "5h"],
    ["secondary_window", "weekly"],
    ["secondaryWindow", "weekly"],
  ];
  for (const [key, period] of windows) {
    const windowData = record[key];
    if (!windowData || typeof windowData !== "object") continue;
    addCodexLimit(out, normalizeCodexLimit(windowData as Record<string, unknown>, {
      model: context.model || "",
      period,
      text: "codex usage limit " + period + " " + (context.text || ""),
    }));
  }
}

function collectExplicitCodexBalanceLimits(balance: Record<string, unknown>, out: CodexLimit[]) {
  const rootRateLimit = balance.rate_limit || balance.rateLimit;
  collectCodexRateWindows(rootRateLimit, out, { text: "shared codex rate_limit" });

  const additional = balance.additional_rate_limits || balance.additionalRateLimits || balance.model_rate_limits || balance.modelRateLimits;
  if (!Array.isArray(additional)) return;
  for (const item of additional) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const model = codexContextModel(record);
    const rateLimit = record.rate_limit || record.rateLimit || record;
    collectCodexRateWindows(rateLimit, out, { model, text: "additional codex rate_limit " + textFromValues(record) });
  }
}

function unwrapCodexBalancePayload(value: unknown, seen = new WeakSet<object>()): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);
  const record = value as Record<string, unknown>;
  if (record.rate_limit || record.rateLimit || record.credits || record.additional_rate_limits || record.additionalRateLimits) {
    return record;
  }
  for (const key of ["data", "body", "result", "usage", "balance"]) {
    const child = record[key];
    if (!child || typeof child !== "object") continue;
    const unwrapped = unwrapCodexBalancePayload(child, seen);
    if (unwrapped) return unwrapped;
  }
  return record;
}

function normalizeCodexScalarLimit(key: string, value: unknown, context: CodexContext): CodexLimit | null {
  const text = String(key || "") + " " + (context?.text || "");
  const pct = /ratio|fraction/i.test(text) ? boundedRatio(value) : boundedPercent(value);
  if (pct == null) return null;
  const isRemaining = /remaining|left|available/i.test(text);
  const isUsed = !isRemaining && /used|usage|utilization|consumed/i.test(text);
  if (!isRemaining && !isUsed) return null;
  const period = /5\s*(?:hour|hr|h)|five[_ -]?hour|5h|pt5h/i.test(text) ? "5h" : (/weekly|week|7d|seven[_ -]?day|p7d/i.test(text) ? "weekly" : "");
  if (!period) return null;
  const remainingPct = isRemaining ? pct : boundedPercent(100 - pct);
  const usedPct = isUsed ? pct : boundedPercent(100 - pct);
  return {
    type: "limit",
    title: "",
    period,
    model: context?.model || "",
    remainingPct,
    usedPct,
    remaining: null,
    limit: null,
    resetsAt: "",
  };
}

function collectCodexLimits(value: unknown, out: CodexLimit[], seen: WeakSet<object>, depth: number, context: CodexContext = {}) {
  if (!value || typeof value !== "object" || depth > 8 || out.length >= 12) return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectCodexLimits(item, out, seen, depth + 1, context);
    return;
  }

  const record = value as Record<string, unknown>;
  const normalized = normalizeCodexLimit(record, context);
  if (normalized) {
    addCodexLimit(out, normalized);
  }
  const contextModel = codexContextModel(record, context.model || "");
  for (const [key, child] of Object.entries(record)) {
    const childText = (context.text || "") + " " + key + " " + (child && typeof child === "object" ? textFromValues(child) : "");
    const scalar = normalizeCodexScalarLimit(key, child, { model: contextModel, text: childText });
    if (scalar) {
      addCodexLimit(out, scalar);
    }
    collectCodexLimits(child, out, seen, depth + 1, { model: contextModel, text: childText });
  }
}

function normalizeCodexCredits(balance: Record<string, unknown>): { remaining: number } | null {
  const credits = findFirstValue(balance, ["credits", "creditBalance", "credit_balance", "creditsRemaining", "credits_remaining", "balance"]);
  if (credits == null) return null;
  if (typeof credits === "object") {
    const remaining = findFirstValue(credits, [
      "remaining", "remainingCredits", "remaining_credits", "available", "availableCredits", "available_credits",
      "balance", "creditBalance", "credit_balance", "creditsRemaining", "credits_remaining",
    ]);
    return remaining != null && Number.isFinite(Number(remaining)) ? { remaining: Number(remaining) } : null;
  }
  return Number.isFinite(Number(credits)) ? { remaining: Number(credits) } : null;
}

export interface CodexBalanceSnapshot {
  source: "provider";
  collectedAt: number;
  limits: CodexLimit[];
  credits: { remaining: number } | null;
}

export function normalizeCodexBalance(balance: unknown): CodexBalanceSnapshot | null {
  const unwrapped = unwrapCodexBalancePayload(balance);
  if (!unwrapped || typeof unwrapped !== "object") return null;
  const limits: CodexLimit[] = [];
  collectExplicitCodexBalanceLimits(unwrapped, limits);
  if (limits.length === 0) collectCodexLimits(unwrapped, limits, new WeakSet(), 0);
  const credits = normalizeCodexCredits(unwrapped);
  const snapshot: CodexBalanceSnapshot = {
    source: "provider",
    collectedAt: Date.now(),
    limits,
    credits,
  };
  return limits.length > 0 || snapshot.credits ? snapshot : null;
}

export function pollChatgptUsage() {
  const doFetch = (token: string | null) => {
    const chatPromise = token ? fetchChatgptChatUsage(token) : Promise.resolve(null);
    Promise.all([chatPromise, fetchCodexUsage(token)])
      .then(([chat, codex]) => {
        const hasCodexData = codex && Object.keys(codex).some((key) => key !== "errors");
        if (!chat && !hasCodexData) return;
        const codexWithAnalytics: CodexUsagePayload & { analytics?: CodexBalanceSnapshot } = Object.assign({}, codex);
        const analytics = normalizeCodexBalance(codex.balance);
        if (analytics) codexWithAnalytics.analytics = analytics;
        const usage: Record<string, unknown> = {
          source: "provider",
          codex: codexWithAnalytics,
        };
        if (chat && !chat.error) {
          usage.chat = chat;
          usage.limits = chat.limits || [];
          usage.modelLimits = chat.modelLimits || [];
        }
        send({
          type: "insights-usage",
          platform: "chatgpt",
          usage,
        });
      })
      .catch(() => {});
  };

  const token = getChatgptAccessToken();
  if (token) {
    doFetch(token);
  } else {
    refreshChatgptToken().then((freshToken) => { doFetch(freshToken); });
  }
}
