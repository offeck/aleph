// Google Antigravity / Cloud Code quota parsing. The background provider fetcher
// owns OAuth and network calls; this module only normalizes raw provider JSON.

type RawRecord = Record<string, any>;

export interface AntigravityCredits {
  limit: number;
  remaining: number;
  used: number;
  remainingPct: number;
  usedPct: number;
}

export interface AntigravityModelLimit {
  id: string;
  name: string;
  provider: string | null;
  limit: number;
  remaining: number;
  used: number;
  remainingPct: number;
  usedPct: number;
  resetsAt: string | null;
  exhausted: boolean;
  autocomplete: boolean;
}

export interface AntigravityUsage {
  source: "provider";
  planType: string | null;
  credits: AntigravityCredits | null;
  models: AntigravityModelLimit[];
  project: string | null;
}

function asRecord(value: unknown): RawRecord | null {
  return value && typeof value === "object" ? value as RawRecord : null;
}

function asNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function roundPct(n: number): number {
  return Math.round(clamp(n, 0, 100) * 100) / 100;
}

function normalizedFraction(value: unknown): number | null {
  const n = asNumber(value);
  if (n == null) return null;
  return clamp(n > 1 && n <= 100 ? n / 100 : n, 0, 1);
}

export function extractAntigravityProjectId(loadCodeAssist: unknown): string | null {
  const record = asRecord(loadCodeAssist);
  const project = record?.cloudaicompanionProject;
  if (typeof project === "string" && project) return project;
  const projectRecord = asRecord(project);
  const id = projectRecord?.id;
  return typeof id === "string" && id ? id : null;
}

function normalizeCredits(loadCodeAssist: unknown): AntigravityCredits | null {
  const record = asRecord(loadCodeAssist);
  const planInfo = asRecord(record?.planInfo);
  const limit = asNumber(planInfo?.monthlyPromptCredits);
  const remainingRaw = asNumber(record?.availablePromptCredits);
  if (limit == null || remainingRaw == null || limit <= 0) return null;

  const remaining = clamp(remainingRaw, 0, limit);
  const used = Math.max(0, limit - remaining);
  return {
    limit,
    remaining,
    used,
    remainingPct: roundPct((remaining / limit) * 100),
    usedPct: roundPct((used / limit) * 100),
  };
}

function inferProvider(id: string, name: string): string | null {
  const text = (id + " " + name).toLowerCase();
  if (/claude|anthropic/.test(text)) return "Claude";
  if (/gemini|google/.test(text)) return "Gemini";
  if (/gpt|openai/.test(text)) return "OpenAI";
  return null;
}

function shouldKeepModel(id: string, model: RawRecord): boolean {
  const name = String(model.displayName || model.label || "");
  const text = (id + " " + name).toLowerCase();
  if (!asRecord(model.quotaInfo)) return false;
  if (/^(chat_|tab_|rev)/.test(id)) return false;
  if (/image|mquery|lite/.test(text)) return false;
  return true;
}

function normalizeModel(id: string, model: RawRecord): AntigravityModelLimit | null {
  if (!shouldKeepModel(id, model)) return null;
  const quota = asRecord(model.quotaInfo)!;
  const exhausted = quota.isExhausted === true;
  const fraction = normalizedFraction(quota.remainingFraction);
  if (fraction == null && !exhausted) return null;

  const remainingPct = roundPct((fraction ?? 0) * 100);
  const usedPct = roundPct(100 - remainingPct);
  const name = String(model.displayName || model.label || id);
  const resetTime = quota.resetTime;
  return {
    id,
    name,
    provider: inferProvider(id, name),
    limit: 100,
    remaining: remainingPct,
    used: usedPct,
    remainingPct,
    usedPct,
    resetsAt: typeof resetTime === "string" && resetTime ? resetTime : null,
    exhausted: exhausted || remainingPct <= 0,
    autocomplete: /gemini-2\.5/i.test(id + " " + name),
  };
}

// Cloud Code payloads are raw provider JSON, hence the `any` boundary.
export function normalizeAntigravityUsage(loadCodeAssist: any, availableModels: any): AntigravityUsage | null {
  const loadRecord = asRecord(loadCodeAssist);
  const modelMap = asRecord(availableModels?.models);
  const models: AntigravityModelLimit[] = [];
  if (modelMap) {
    for (const [id, model] of Object.entries(modelMap)) {
      const normalized = asRecord(model) ? normalizeModel(id, model as RawRecord) : null;
      if (normalized) models.push(normalized);
    }
  }
  models.sort((a, b) => (b.usedPct - a.usedPct) || a.name.localeCompare(b.name));

  const credits = normalizeCredits(loadCodeAssist);
  if (!credits && models.length === 0) return null;

  const planType = loadRecord?.planInfo && typeof loadRecord.planInfo.planType === "string"
    ? loadRecord.planInfo.planType
    : null;

  return {
    source: "provider",
    planType,
    credits,
    models,
    project: extractAntigravityProjectId(loadCodeAssist),
  };
}
