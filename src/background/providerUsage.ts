import type { UsageRefreshReason, UsageRefreshResponse } from "../shared/messages";
import type { Platform } from "../shared/platform";
import { PRICING } from "../shared/pricing";
import {
  collectChatgptPlanSignals,
  normalizeChatgptPlan,
  type ChatgptPlan,
  type ClaudePlan,
  type GeminiPlan,
  type PlanDetection,
} from "../tracker/plans";
import { getAntigravityAccessToken, getAntigravityAuthStatus } from "./antigravityAuth";
import {
  extractAntigravityProjectId,
  normalizeAntigravityUsage,
} from "../tracker/usageAntigravity";
import { normalizeCodexBalance } from "../tracker/usageChatgpt";
import { parseGeminiQuotas, type GeminiFeature } from "../tracker/usageGemini";
import { updateUsageMetricChanges } from "./metrics";
import { readLocal, writeLocal } from "./usage";

// Provider/storage snapshots are raw JSON boundaries.
type RawRecord = Record<string, any>;
type BackgroundUsagePlatform = Platform;

interface PlatformRefreshResult {
  refreshed: boolean;
  reason?: UsageRefreshReason;
}

interface ProviderFetchResult {
  usage: RawRecord | null;
  plan?: PlanDetection | null;
  reason?: UsageRefreshReason;
}

const BACKGROUND_USAGE_PLATFORMS: BackgroundUsagePlatform[] = ["chatgpt", "claude", "gemini"];
// Platforms whose plan the background reads reliably (Claude's rate_limit_tier,
// ChatGPT's session planType). Gemini's tab-less plan is best-effort (often null
// by design), so a missing Gemini subscription is normal — not a retry-worthy gap.
const PLAN_FORCE_PLATFORMS: BackgroundUsagePlatform[] = ["chatgpt", "claude"];
const CHATGPT_ORIGINS = ["https://chatgpt.com", "https://chat.openai.com"];
const GEMINI_ORIGIN = "https://gemini.google.com";
// Antigravity's Cloud Code channel. If a Gemini-CLI-minted token is rejected
// here, the stable Code Assist host `https://cloudcode-pa.googleapis.com` is a
// drop-in fallback (both are host-permitted).
const CLOUDCODE_ORIGIN = "https://daily-cloudcode-pa.googleapis.com";
const ANTIGRAVITY_METADATA = {
  ideType: "ANTIGRAVITY",
  platform: "PLATFORM_UNSPECIFIED",
  pluginType: "GEMINI",
};
export const LIMITS_REFRESH_ALARM = "aleph-refresh-limits";
export const LIMITS_REFRESH_PERIOD_MINUTES = 20;

export type UsageRefreshTrigger = "popup" | "alarm";

// Skip a platform's network refresh when its stored snapshot is newer than
// this. A popup open tolerates ~1-min-old data (reopening the view or a
// just-polling tab won't refetch); the periodic alarm tolerates ~15 min, so a
// recent popup/tab refresh makes the alarm a no-op for that platform.
const FRESH_TTL_MS: Record<UsageRefreshTrigger, number> = {
  popup: 60 * 1000,
  alarm: 15 * 60 * 1000,
};

const inFlight: Partial<Record<BackgroundUsagePlatform, Promise<PlatformRefreshResult>>> = {};
let subscriptionUpdateQueue: Promise<unknown> = Promise.resolve();
let makeRequestId = () => Math.floor(Math.random() * 9999999);

// True when the stored snapshot is missing or older than ttlMs — i.e. worth a
// network refresh. Pure (no chrome APIs) so it is unit-tested directly.
export function shouldRefreshUsage(snapshot: RawRecord | null, now: number, ttlMs: number): boolean {
  const fetchedAt = typeof snapshot?.fetchedAt === "number" ? snapshot.fetchedAt : 0;
  return now - fetchedAt >= ttlMs;
}

async function fetchJson(url: string, options: RequestInit = {}): Promise<unknown> {
  const response = await fetch(url, {
    cache: "no-store",
    ...options,
    credentials: options.credentials || "include",
  });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}

async function fetchText(url: string, options: RequestInit = {}): Promise<string> {
  const response = await fetch(url, {
    cache: "no-store",
    ...options,
    credentials: options.credentials || "include",
  });
  if (!response.ok) throw new Error(String(response.status));
  return response.text();
}

function statusFromError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function fetchCloudCodeJson(endpoint: string, token: string, body: unknown): Promise<unknown> {
  return fetchJson(CLOUDCODE_ORIGIN + endpoint, {
    method: "POST",
    credentials: "omit",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

// ── Provider API-shape canary ─────────────────────────────
// Surfaces silent provider drift: a 200 response whose expected field is missing
// or unrecognized (e.g. ChatGPT's "prolite" planType, which slipped through
// undetected). Stores only a bounded scalar sample — never full RPC/account
// payloads — under a local-only key (no sync prefix).
export function chatgptPlanTypeRaw(session: unknown): string | null {
  const account = session && typeof session === "object" ? (session as RawRecord).account : null;
  const planType = account && typeof account === "object" ? (account as RawRecord).planType : null;
  return typeof planType === "string" && planType ? planType : null;
}

async function recordProviderDrift(platform: string, kind: string, sample: unknown) {
  try {
    const all = await readLocal<RawRecord>("insights_contract_drift", {});
    const text = typeof sample === "string" ? sample : String(sample);
    all[platform] = { kind, sample: text.slice(0, 64), at: Date.now() };
    await writeLocal("insights_contract_drift", all);
    console.warn("[Aleph] provider shape drift: " + platform + " " + kind + " sample=" + all[platform].sample);
  } catch (e) {}
}

function normalizeChatgptLimit(lp: RawRecord) {
  return {
    feature: lp.feature_name || lp.feature || lp.name,
    remaining: lp.remaining,
    limit: lp.limit ?? lp.max ?? lp.total,
    used: lp.used ?? lp.consumed,
    resetsAt: lp.reset_after ?? lp.resets_at,
  };
}

function normalizeChatgptModelLimit(ml: RawRecord) {
  return {
    model: ml.model_slug || ml.model || ml.slug,
    remaining: ml.remaining,
    limit: ml.limit ?? ml.max ?? ml.total,
    used: ml.used ?? ml.consumed,
    resetsAt: ml.reset_after ?? ml.resets_at,
  };
}

function normalizeChatgptChatUsage(data: unknown) {
  const record = data && typeof data === "object" ? data as RawRecord : {};
  return {
    limits: Array.isArray(record.limits_progress) ? record.limits_progress.map(normalizeChatgptLimit) : [],
    modelLimits: Array.isArray(record.model_limits) ? record.model_limits.map(normalizeChatgptModelLimit) : [],
  };
}

function normalizeChatgptPlanFromSession(session: unknown): ChatgptPlan | null {
  if (!session || typeof session !== "object") return null;
  const account = (session as RawRecord).account;
  if (!account || typeof account !== "object") return null;
  return normalizeChatgptPlan((account as RawRecord).planType as string | null | undefined, {
    signals: collectChatgptPlanSignals(account),
  });
}

function firstStringValue(obj: unknown, names: string[]): string | null {
  if (!obj || typeof obj !== "object") return null;
  const record = obj as RawRecord;
  for (const name of names) {
    const value = record[name];
    if (typeof value === "string" && value) return value;
  }
  return null;
}

function decodeJwtPayload(token: unknown): RawRecord | null {
  if (typeof token !== "string" || !token.includes(".")) return null;
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = part + "=".repeat((4 - (part.length % 4)) % 4);
    const parsed = JSON.parse(atob(padded));
    return parsed && typeof parsed === "object" ? parsed as RawRecord : null;
  } catch (e) {
    return null;
  }
}

export function chatgptAccountIdRaw(session: unknown): string | null {
  if (!session || typeof session !== "object") return null;
  const record = session as RawRecord;
  const accountId = firstStringValue(record.account, ["id", "accountId", "account_id"]) ||
    firstStringValue(record, ["accountId", "account_id", "chatgptAccountId", "chatgpt_account_id"]);
  if (accountId) return accountId;

  const jwt = decodeJwtPayload(record.accessToken);
  return firstStringValue(jwt?.["https://api.openai.com/auth"], ["chatgpt_account_id", "account_id"]) ||
    firstStringValue(jwt, ["chatgpt_account_id", "account_id"]);
}

type ChatgptSession = { origin: string; token: string | null; accountId: string | null; plan: ChatgptPlan | null };

async function fetchChatgptSession(): Promise<ChatgptSession | null> {
  // A 200 from one origin can still be a token-less guest session while the real
  // session lives on the other origin, so keep trying until one yields a token;
  // only fall back to a token-less response if none do.
  let fallback: ChatgptSession | null = null;
  for (const origin of CHATGPT_ORIGINS) {
    try {
      const session = await fetchJson(origin + "/api/auth/session");
      const rawToken = session && typeof session === "object" ? (session as RawRecord).accessToken : null;
      const result: ChatgptSession = {
        origin,
        token: typeof rawToken === "string" ? rawToken : null,
        accountId: chatgptAccountIdRaw(session),
        plan: normalizeChatgptPlanFromSession(session),
      };
      if (!result.plan) {
        const planType = chatgptPlanTypeRaw(session);
        if (planType) void recordProviderDrift("chatgpt", "plan-unrecognized", planType);
      }
      if (result.token) return result;
      if (!fallback) fallback = result;
    } catch (e) {}
  }
  return fallback;
}

async function fetchChatgptProviderUsage(): Promise<ProviderFetchResult> {
  const session = await fetchChatgptSession();
  const origin = session?.origin || CHATGPT_ORIGINS[0];
  const token = session?.token || null;
  const authHeaders: HeadersInit = token ? {
    Authorization: "Bearer " + token,
    ...(session?.accountId ? { "ChatGPT-Account-Id": session.accountId } : {}),
  } : {};

  const chatPromise = token
    ? fetchJson(origin + "/backend-api/conversation/init", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: "{}",
    }).then(normalizeChatgptChatUsage)
    : Promise.resolve(null);

  const codexPromise = fetchJson(origin + "/backend-api/wham/usage", { headers: authHeaders })
    .then((balance) => {
      const codex: RawRecord = { balance };
      const analytics = normalizeCodexBalance(balance);
      if (analytics) codex.analytics = analytics;
      return codex;
    });

  const [chatResult, codexResult] = await Promise.allSettled([chatPromise, codexPromise]);
  const usage: RawRecord = { source: "provider" };

  if (chatResult.status === "fulfilled" && chatResult.value) {
    // A fulfilled-but-empty conversation/init (e.g. a partial provider failure)
    // must NOT replace previously stored limits, so only treat chat usage as
    // present when at least one array has rows — otherwise the snapshot merge
    // preserves the prior chat/model limits.
    const chat = chatResult.value;
    if ((chat.limits?.length || 0) > 0 || (chat.modelLimits?.length || 0) > 0) {
      usage.chat = chat;
      usage.limits = chat.limits || [];
      usage.modelLimits = chat.modelLimits || [];
    }
  }
  if (codexResult.status === "fulfilled") {
    usage.codex = codexResult.value;
  }

  const hasUsage = Boolean(usage.chat || usage.codex);
  return {
    usage: hasUsage ? usage : null,
    plan: session?.plan ? { plan: session.plan, model: null } : null,
    reason: token ? "no-data" : "missing-auth",
  };
}

function getCookie(details: chrome.cookies.CookieDetails): Promise<chrome.cookies.Cookie | null> {
  return new Promise((resolve) => {
    chrome.cookies.get(details, (cookie) => resolve(cookie || null));
  });
}

function decodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch (e) {
    return value;
  }
}

export function extractClaudeOrgId(value: unknown, depth = 0): string | null {
  if (!value || depth > 4) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const id = extractClaudeOrgId(item, depth + 1);
      if (id) return id;
    }
    return null;
  }
  if (typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  // Unambiguous org-id keys win first.
  for (const key of ["organization_uuid", "organizationUuid"]) {
    const id = record[key];
    if (typeof id === "string" && id) return id;
  }
  // Then nested org collections — a wrapper's generic id/uuid is not an org id,
  // so prefer a real org object found inside these before falling back to it.
  for (const key of ["organizations", "orgs", "data"]) {
    const id = extractClaudeOrgId(record[key], depth + 1);
    if (id) return id;
  }
  // Finally, a bare uuid/id on an org object itself.
  for (const key of ["uuid", "id"]) {
    const id = record[key];
    if (typeof id === "string" && id) return id;
  }
  return null;
}

async function getClaudeOrgId(): Promise<string | null> {
  const cookie = await getCookie({ url: "https://claude.ai/", name: "lastActiveOrg" });
  if (cookie?.value) return decodeCookieValue(cookie.value);
  try {
    return extractClaudeOrgId(await fetchJson("https://claude.ai/api/organizations"));
  } catch (e) {
    return null;
  }
}

function normalizeClaudeUsage(data: unknown): RawRecord | null {
  if (!data || typeof data !== "object") return null;
  const record = data as RawRecord;
  return {
    source: "provider",
    fiveHour: record.five_hour ? {
      utilization: record.five_hour.utilization,
      resetsAt: record.five_hour.resets_at,
    } : null,
    sevenDay: record.seven_day ? {
      utilization: record.seven_day.utilization,
      resetsAt: record.seven_day.resets_at,
    } : null,
    sonnet: record.seven_day_sonnet ? { utilization: record.seven_day_sonnet.utilization } : null,
    extraUsage: record.extra_usage || null,
  };
}

export function normalizeClaudePlanFromOrg(data: unknown): ClaudePlan | null {
  if (!data || typeof data !== "object") return null;
  const tier = String((data as RawRecord).rate_limit_tier || "");
  if (!tier) return null;
  if (/max_20x/i.test(tier)) return "max20x";
  if (/max_5x/i.test(tier)) return "max5x";
  if (/max/i.test(tier)) return "max5x";
  if (/pro/i.test(tier)) return "pro";
  return "free";
}

async function fetchClaudeProviderUsage(): Promise<ProviderFetchResult> {
  const orgId = await getClaudeOrgId();
  if (!orgId) return { usage: null, reason: "missing-auth" };

  const orgUrl = "https://claude.ai/api/organizations/" + encodeURIComponent(orgId);
  const [orgResult, usageResult] = await Promise.allSettled([
    fetchJson(orgUrl),
    fetchJson(orgUrl + "/usage"),
  ]);
  const usage = usageResult.status === "fulfilled" ? normalizeClaudeUsage(usageResult.value) : null;
  const plan = orgResult.status === "fulfilled" ? normalizeClaudePlanFromOrg(orgResult.value) : null;
  return {
    usage,
    plan: plan ? { plan, model: null } : null,
    reason: usage || plan ? undefined : "no-data",
  };
}

interface GeminiSessionData {
  sid: string;
  at: string;
  bl: string;
}

export function parseGeminiSessionData(text: string): GeminiSessionData {
  const sidMatch = text.match(/FdrFJe["']?\s*[:=]\s*["']([^"']+)["']/);
  const atMatch = text.match(/SNlM0e["']?\s*[:=]\s*["']([^"']+)["']/);
  const blMatch = text.match(/boq_assistant-bard-web-server_[^"'\\\s&/]+/);
  return {
    sid: sidMatch?.[1] || "",
    at: atMatch?.[1] || "",
    bl: blMatch ? decodeCookieValue(blMatch[0]) : "",
  };
}

function parseGeminiBatchExecute(raw: string): unknown | null {
  const lines = raw.split("\n").filter((line) => line.trim());
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (!Array.isArray(parsed)) continue;
      const dataStr = parsed[0]?.[2];
      return dataStr ? JSON.parse(dataStr) : null;
    } catch (e) {}
  }
  return null;
}

export function inferGeminiPlanFromQuotas(features: GeminiFeature[]): GeminiPlan | null {
  // Ultra-only features (id 12) are an unambiguous paid signal. We deliberately
  // do NOT infer ai_pro from a credit pool or generic feature rows: free
  // accounts also report an account-wide daily credit pool (see usageGemini.ts),
  // so that would misclassify them as paid. The precise free/pro/ultra split is
  // read by the content-script DOM detector (detectGeminiSubscription) while a
  // Gemini tab is open; tab-lessly we assert only the Ultra signal.
  return features.some((feature) => feature.id === 12) ? "ai_ultra" : null;
}

async function fetchGeminiWebProviderUsage(): Promise<ProviderFetchResult> {
  const html = await fetchText(GEMINI_ORIGIN + "/app");
  const { sid, at, bl } = parseGeminiSessionData(html);
  if (!sid) return { usage: null, reason: "missing-auth" };

  const body = new URLSearchParams();
  body.append("f.req", JSON.stringify([[["qpEbW", "[]", null, "generic"]]]));
  body.append("at", at);

  let url = GEMINI_ORIGIN + "/_/BardChatUi/data/batchexecute?rpcids=qpEbW&source-path=" + encodeURIComponent("/app");
  if (bl) url += "&bl=" + encodeURIComponent(bl);
  url += "&f.sid=" + encodeURIComponent(sid) + "&hl=en&_reqid=" + makeRequestId() + "&rt=c";

  const quotas = parseGeminiBatchExecute(await fetchText(url, {
    method: "POST",
    body,
  }));
  if (!Array.isArray(quotas) || !Array.isArray(quotas[0])) {
    // A non-null but wrong-shaped payload is real drift; a null parse is treated
    // as transient (no warn) to avoid noise on empty/expired sessions.
    if (quotas != null) void recordProviderDrift("gemini", "quota-shape", JSON.stringify(quotas));
    return { usage: null, reason: "no-data" };
  }

  const { credits, features } = parseGeminiQuotas(quotas);
  const plan = inferGeminiPlanFromQuotas(features);
  return {
    usage: {
      source: "provider",
      credits,
      features,
      mainChat: features[0] || null,
      activeModel: null,
      buildLabel: bl || null,
    },
    plan: plan ? { plan, model: null } : null,
  };
}

// ── Antigravity drift canary ──────────────────────────────
// fetchAvailableModels is an undocumented internal endpoint gated on a project id
// and the antigravity/cli User-Agent (set via declarativeNetRequest). The brittle
// failure isn't an error — it's a 200 whose model/quota shape changed, so the
// normalizer keeps nothing and the popup silently empties. This flags exactly that:
// raw model entries present in the response, but zero survive normalization. Pure
// (no chrome/network), so it is unit-tested directly.
export function detectAntigravityModelDrift(availableModels: unknown, normalizedModelCount: number): { kind: string; sample: string } | null {
  const map = availableModels && typeof availableModels === "object" ? (availableModels as RawRecord).models : null;
  const rawCount = map && typeof map === "object" ? Object.keys(map).length : 0;
  if (rawCount > 0 && normalizedModelCount === 0) {
    return { kind: "models-shape", sample: "raw=" + rawCount + " kept=0" };
  }
  return null;
}

async function fetchAntigravityProviderUsage(): Promise<ProviderFetchResult> {
  // Gated purely on connection: off by default (nothing connected), inert
  // (no network) until the user connects from the popup. Disconnect (in
  // settings) clears the token and turns it back off.
  const token = await getAntigravityAccessToken();
  if (!token) return { usage: null, reason: "missing-auth" };

  let loadCodeAssist: unknown;
  try {
    loadCodeAssist = await fetchCloudCodeJson("/v1internal:loadCodeAssist", token, { metadata: ANTIGRAVITY_METADATA });
  } catch (e) {
    const status = statusFromError(e);
    if (status === "401" || status === "403") return { usage: null, reason: "missing-auth" };
    if (status === "400" || status === "404") return { usage: null, reason: "no-data" };
    throw e;
  }

  let availableModels: unknown = {};
  try {
    const project = extractAntigravityProjectId(loadCodeAssist);
    availableModels = await fetchCloudCodeJson("/v1internal:fetchAvailableModels", token, project ? { project } : {});
  } catch (e) {
    const status = statusFromError(e);
    if (status === "401" || status === "403") return { usage: null, reason: "missing-auth" };
    // Accounts without an initialized Cloud Code project can still expose
    // prompt-credit plan data from loadCodeAssist, so keep that partial result.
  }

  const usage = normalizeAntigravityUsage(loadCodeAssist, availableModels);
  const drift = detectAntigravityModelDrift(availableModels, usage?.models.length || 0);
  if (drift) void recordProviderDrift("antigravity", drift.kind, drift.sample);
  return { usage, reason: usage ? undefined : "no-data" };
}

async function fetchGeminiProviderUsage(): Promise<ProviderFetchResult> {
  const [geminiResult, antigravityResult] = await Promise.allSettled([
    fetchGeminiWebProviderUsage(),
    fetchAntigravityProviderUsage(),
  ]);
  const gemini = geminiResult.status === "fulfilled" ? geminiResult.value : { usage: null, reason: "error" as const };
  const antigravity = antigravityResult.status === "fulfilled" ? antigravityResult.value : { usage: null, reason: "error" as const };

  // Re-check the connection at WRITE time, after the network round-trip. A refresh
  // that obtained a token can land after the user disconnects (or the token was
  // revoked mid-flight); accepting its `antigravity.usage` would resurrect meters a
  // just-completed disconnect cleared. So keep Antigravity data only while still
  // connected — otherwise drop it (fresh OR stale) and strip any stored block
  // (no-op if none). A transient failure keeps the auth, so its meters survive.
  const antigravityConnected = (await getAntigravityAuthStatus()).connected;
  const antigravityUsage = antigravityConnected ? antigravity.usage : null;
  if (!antigravityConnected) await clearAntigravityUsage();

  const usage: RawRecord = gemini.usage ? { ...gemini.usage } : { source: "provider" };
  if (antigravityUsage) usage.antigravity = antigravityUsage;

  if (gemini.usage || antigravityUsage) {
    return {
      usage,
      plan: gemini.plan,
    };
  }
  return {
    usage: null,
    plan: gemini.plan,
    reason: gemini.reason === "missing-auth" && antigravity.reason === "missing-auth"
      ? "missing-auth"
      : gemini.reason || antigravity.reason || "no-data",
  };
}

export function prepareProviderUsageSnapshot(
  platform: string,
  previous: RawRecord | null,
  usage: RawRecord | undefined,
  fetchedAt = Date.now()
): RawRecord {
  const nextUsage: RawRecord = {
    ...(usage || {}),
    source: usage?.source || "provider",
    fetchedAt,
  };
  if (platform === "chatgpt") {
    if (!nextUsage.chat && previous?.chat) nextUsage.chat = previous.chat;
    if (!nextUsage.limits && previous?.limits) nextUsage.limits = previous.limits;
    if (!nextUsage.modelLimits && previous?.modelLimits) nextUsage.modelLimits = previous.modelLimits;
    if (!nextUsage.codex && previous?.codex) {
      nextUsage.codex = previous.codex;
    } else if (nextUsage.codex && previous?.codex) {
      nextUsage.codex = Object.assign({}, previous.codex, nextUsage.codex);
    }
  }
  if (platform === "gemini") {
    for (const key of ["credits", "features", "mainChat", "activeModel", "buildLabel"]) {
      if (!(key in nextUsage) && key in (previous || {})) nextUsage[key] = previous?.[key];
    }
    if (!nextUsage.antigravity && previous?.antigravity) {
      nextUsage.antigravity = previous.antigravity;
    } else if (nextUsage.antigravity && previous?.antigravity) {
      nextUsage.antigravity = Object.assign({}, previous.antigravity, nextUsage.antigravity);
    }
  }
  Object.assign(nextUsage, updateUsageMetricChanges(platform, previous, nextUsage));
  return nextUsage;
}

export async function saveProviderUsageSnapshot(platform: string, usage?: RawRecord) {
  const key = "insights_platform_usage_" + platform;
  const previous = await readLocal<RawRecord | null>(key, null);
  await writeLocal(key, prepareProviderUsageSnapshot(platform, previous, usage));
}

// Drop the Antigravity block from the stored Gemini snapshot on disconnect.
// prepareProviderUsageSnapshot's gemini branch preserves `antigravity` whenever a
// refresh lacks it (guarding partial provider failures), so without this the popup
// keeps rendering stale Antigravity meters after the token is gone. Removing it
// from the snapshot also means later merges have nothing to preserve. The write
// fires storage.onChanged, which re-renders the popup.
export async function clearAntigravityUsage(): Promise<void> {
  const key = "insights_platform_usage_gemini";
  const snap = await readLocal<RawRecord | null>(key, null);
  if (!snap || !snap.antigravity) return;
  const next = { ...snap };
  delete next.antigravity;
  await writeLocal(key, next);
}

// Clears stale Antigravity meters independent of the freshness throttle: a build
// that went inert (secret removed) or a disconnect while the Gemini snapshot is
// still fresh would otherwise keep showing old meters until the snapshot ages out.
// Gemini-only; no-op when connected or nothing is stored. Returns whether it cleared.
async function clearDisconnectedAntigravityUsage(platform: BackgroundUsagePlatform, snapshot: RawRecord | null): Promise<boolean> {
  if (platform !== "gemini" || !snapshot?.antigravity) return false;
  if ((await getAntigravityAuthStatus()).connected) return false;
  await clearAntigravityUsage();
  return true;
}

async function saveProviderPlan(platform: Platform, plan: PlanDetection | null | undefined): Promise<boolean> {
  if (!plan) return false;
  const run = subscriptionUpdateQueue.catch(() => {}).then(async () => {
    const subs = await readLocal<RawRecord>("insights_subscriptions", {});
    if (subs[platform]?.manualOverride) return false;
    const pricing = PRICING[platform][plan.plan];
    subs[platform] = {
      plan: plan.plan,
      price: pricing ? pricing.price : 0,
      label: pricing ? pricing.label : plan.plan,
      // Background detection can't read the active model; keep the one the
      // content-script detector stored rather than clobbering it with null.
      model: plan.model ?? subs[platform]?.model ?? null,
      detectedAt: Date.now(),
      manualOverride: false,
    };
    await writeLocal("insights_subscriptions", subs);
    return true;
  });
  subscriptionUpdateQueue = run.catch(() => {});
  return run;
}

async function fetchProviderUsage(platform: BackgroundUsagePlatform): Promise<ProviderFetchResult> {
  if (platform === "chatgpt") return fetchChatgptProviderUsage();
  if (platform === "claude") return fetchClaudeProviderUsage();
  return fetchGeminiProviderUsage();
}

async function refreshPlatformUsage(platform: BackgroundUsagePlatform, trigger: UsageRefreshTrigger, force = false): Promise<PlatformRefreshResult> {
  // Dedup concurrent refreshes — but a forced refresh must NOT reuse a non-forced
  // in-flight one (e.g. the popup's opening refresh that ran *before* the user
  // connected Antigravity); reusing it would return stale, token-less data. Chain
  // the forced run after the in-flight one so it re-fetches with the now-present token.
  const existing = inFlight[platform];
  if (existing && !force) return existing;
  const run = (async () => {
    if (existing) { try { await existing; } catch (e) {} }
    // Skip the network (auth fetch included) when the stored snapshot is still
    // fresh — the content script and prior refreshes write the same fetchedAt,
    // so an open tab or a recent refresh makes this a no-op. `force` bypasses this
    // for deliberate user actions (e.g. just-connected Antigravity) whose new data
    // would otherwise be suppressed by the popup's own opening refresh.
    const key = "insights_platform_usage_" + platform;
    const previous = await readLocal<RawRecord | null>(key, null);
    if (!force && !shouldRefreshUsage(previous, Date.now(), FRESH_TTL_MS[trigger])) {
      // Usage is fresh — but the user wants tab-less PLAN detection too, so a
      // fresh usage snapshot must not permanently suppress a never-detected plan
      // (e.g. a prior cycle saved usage but the plan endpoint failed). For
      // plan-reliable platforms, force a fetch while the subscription is still
      // missing; once it exists the usage cadence keeps it current (plan + usage
      // share the fetch). Gemini is excluded — its tab-less plan is best-effort,
      // so a missing Gemini subscription is normal, not a failure to retry.
      const subs = await readLocal<RawRecord>("insights_subscriptions", {});
      if (subs[platform] || !PLAN_FORCE_PLATFORMS.includes(platform)) {
        // Even while throttled, drop stale Antigravity meters if the account is gone
        // (build went inert / disconnected) — the fetch-path clear is skipped here.
        if (await clearDisconnectedAntigravityUsage(platform, previous)) return { refreshed: true };
        return { refreshed: false, reason: "throttled" as const };
      }
    }
    try {
      const result = await fetchProviderUsage(platform);
      let savedUsage = false;
      if (result.usage) {
        await saveProviderUsageSnapshot(platform, result.usage);
        savedUsage = true;
      }
      const savedPlan = await saveProviderPlan(platform, result.plan);
      if (!savedUsage && !savedPlan) return { refreshed: false, reason: result.reason || "no-data" };
      return { refreshed: true };
    } catch (e) {
      return { refreshed: false, reason: "error" as const };
    }
  })();
  inFlight[platform] = run;
  // Guard against a chained run clearing a newer entry that has replaced it.
  run.finally(() => { if (inFlight[platform] === run) delete inFlight[platform]; });
  return run;
}

export async function refreshProviderUsage(trigger: UsageRefreshTrigger = "popup", force = false): Promise<UsageRefreshResponse> {
  const entries = await Promise.all(BACKGROUND_USAGE_PLATFORMS.map(async (platform) => {
    const result = await refreshPlatformUsage(platform, trigger, force);
    return [platform, result] as const;
  }));
  const platforms = Object.fromEntries(entries);
  return {
    refreshed: entries.some(([, result]) => result.refreshed),
    platforms,
  };
}

export function _resetProviderUsageRefreshStateForTests(requestIdFactory = () => 123456) {
  for (const platform of BACKGROUND_USAGE_PLATFORMS) {
    delete inFlight[platform];
  }
  subscriptionUpdateQueue = Promise.resolve();
  makeRequestId = requestIdFactory;
}
