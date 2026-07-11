import { readLocal, writeLocal, enqueueUsageWork } from "./usage";
import { fetchChatgptSession, getClaudeOrgId, fetchJson } from "./providerUsage";
import {
  buildCodexPrimerRequest, buildClaudeCreateRequest,
  buildClaudeCompletionRequest, buildClaudeDeleteRequest, parseCodexPrimary,
} from "./primerRequests";
import {
  pickGreeting, desiredPrimerAlarmNames, computeAlarmWhen, nextSmartFire,
  PRIMER_ALARM_PREFIX, type PrimerTarget,
} from "./primerSchedule";
import { DEFAULTS } from "../shared/defaults";

export const PRIMER_STATUS_KEY = "primer_status";

export interface PrimerRunResult {
  at: number;
  ok: boolean;
  reason?: string;
  windowResetAt?: number;
  usedPercent?: number;
}

// A failed primer sets a global toolbar "!" (no tabId). The per-tab feature-count
// badge still overrides on AI-platform tabs; on every other tab the "!" is visible.
export function raiseFailureBadge(): void {
  try {
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#e5484d" });
  } catch (e) { /* action API may be absent in some contexts/tests */ }
}

export function clearFailureBadge(): void {
  try { chrome.action.setBadgeText({ text: "" }); } catch (e) { /* noop */ }
}

export async function recordPrimerResult(target: PrimerTarget, r: PrimerRunResult): Promise<void> {
  await enqueueUsageWork(async () => {
    const all = await readLocal<Record<string, PrimerRunResult>>(PRIMER_STATUS_KEY, {});
    all[target] = r;
    await writeLocal(PRIMER_STATUS_KEY, all);
  });
  if (!r.ok) raiseFailureBadge();
}

/** Reads the status map and clears the failure badge (the user has now seen it). */
export async function getPrimerStatus(): Promise<Record<string, PrimerRunResult>> {
  clearFailureBadge();
  return readLocal<Record<string, PrimerRunResult>>(PRIMER_STATUS_KEY, {});
}

const DEFAULT_CODEX_MODEL = "gpt-5-codex-mini";

async function doFetch(req: { url: string; method: string; headers: Record<string, string>; body?: string }): Promise<Response> {
  return fetch(req.url, { method: req.method, headers: req.headers, body: req.body, credentials: "include" });
}

/** Read Codex primary-window state (skip-if-active + verify). resetAt in ms, or null. */
export async function readCodexWindow(): Promise<{ active: boolean; resetAt: number | null }> {
  try {
    const session = await fetchChatgptSession();
    const headers: Record<string, string> = session?.token
      ? { Authorization: "Bearer " + session.token, ...(session.accountId ? { "ChatGPT-Account-ID": session.accountId } : {}) }
      : {};
    const origin = session?.origin || "https://chatgpt.com";
    // wham/usage shape confirmed live 2026-07-11: rate_limit.primary_window.{reset_at (unix s), used_percent}.
    const usage = await fetchJson(origin + "/backend-api/wham/usage", { headers, credentials: "include" }) as any;
    const pw = usage?.rate_limit?.primary_window;
    const used = typeof pw?.used_percent === "number" ? pw.used_percent : 0;
    const resetAt = typeof pw?.reset_at === "number" ? pw.reset_at * 1000
      : (typeof pw?.reset_after_seconds === "number" ? Date.now() + pw.reset_after_seconds * 1000 : null);
    return { active: used > 0 && resetAt != null && resetAt > Date.now(), resetAt };
  } catch (e) { return { active: false, resetAt: null }; }
}

/** Read Claude 5h-window state via the org usage endpoint (five_hour.resets_at). */
export async function readClaudeWindow(): Promise<{ active: boolean; resetAt: number | null }> {
  try {
    const orgId = await getClaudeOrgId();
    if (!orgId) return { active: false, resetAt: null };
    // five_hour.{resets_at (ISO), utilization} confirmed live 2026-07-11.
    const usage = await fetchJson(`https://claude.ai/api/organizations/${orgId}/usage`, { credentials: "include" }) as any;
    const fh = usage?.five_hour;
    const iso = fh?.resets_at ?? null;
    const resetAt = iso ? Date.parse(iso) : null;
    const util = typeof fh?.utilization === "number" ? fh.utilization : 0;
    return { active: util > 0 && resetAt != null && resetAt > Date.now(), resetAt };
  } catch (e) { return { active: false, resetAt: null }; }
}

export async function sendCodexPrimer(rng: () => number = Math.random): Promise<PrimerRunResult> {
  const at = Date.now();
  const session = await fetchChatgptSession();
  if (!session?.token || !session.accountId) return { at, ok: false, reason: "signed out of ChatGPT" };
  const req = buildCodexPrimerRequest({
    origin: session.origin, token: session.token, accountId: session.accountId,
    model: DEFAULT_CODEX_MODEL, greeting: pickGreeting(rng),
  });
  const res = await doFetch(req);
  if (!res.ok) return { at, ok: false, reason: `codex responses ${res.status}` };
  await res.text(); // drain SSE
  const primary = parseCodexPrimary(res.headers);
  return { at, ok: true, windowResetAt: primary.resetAt ?? undefined, usedPercent: primary.usedPercent ?? undefined };
}

export async function sendClaudePrimer(autoDelete: boolean, rng: () => number = Math.random): Promise<PrimerRunResult> {
  const at = Date.now();
  const orgId = await getClaudeOrgId();
  if (!orgId) return { at, ok: false, reason: "signed out of Claude" };
  const greeting = pickGreeting(rng);
  const convUuid = crypto.randomUUID();
  const create = await doFetch(buildClaudeCreateRequest(orgId, convUuid));
  if (!create.ok) return { at, ok: false, reason: `claude create ${create.status}` };
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC";
  const comp = await doFetch(buildClaudeCompletionRequest(orgId, convUuid, greeting, tz));
  if (!comp.ok) return { at, ok: false, reason: `claude completion ${comp.status}` };
  await comp.text(); // drain SSE
  if (autoDelete) { try { await doFetch(buildClaudeDeleteRequest(orgId, convUuid)); } catch (e) { /* best-effort cleanup */ } }
  const win = await readClaudeWindow();
  return { at, ok: true, windowResetAt: win.resetAt ?? undefined };
}

type Settings = typeof DEFAULTS;

function getSettings(): Promise<Settings> {
  return new Promise((resolve) => chrome.storage.sync.get(DEFAULTS, (s) => resolve(s as Settings)));
}
function getAllAlarms(): Promise<chrome.alarms.Alarm[]> {
  return new Promise((resolve) => chrome.alarms.getAll((a) => resolve(a)));
}

/** Prime one target unless its window is already running. Records + returns the result. */
export async function runPrimer(target: PrimerTarget): Promise<PrimerRunResult> {
  const s = await getSettings();
  const win = target === "codex" ? await readCodexWindow() : await readClaudeWindow();
  if (win.active) {
    const r: PrimerRunResult = { at: Date.now(), ok: true, reason: "already active", windowResetAt: win.resetAt ?? undefined };
    await recordPrimerResult(target, r);
    return r;
  }
  const r = target === "codex" ? await sendCodexPrimer() : await sendClaudePrimer(s.primerAutoDeleteClaude);
  await recordPrimerResult(target, r);
  return r;
}

export async function runPrimerNow(target?: PrimerTarget): Promise<Record<string, PrimerRunResult>> {
  const s = await getSettings();
  const targets: PrimerTarget[] = target ? [target]
    : [...(s.primerTargetClaude ? ["claude"] as const : []), ...(s.primerTargetCodex ? ["codex"] as const : [])];
  for (const t of targets) await runPrimer(t);
  return getPrimerStatus();
}

/** Clear every aleph-primer* alarm and recreate the desired set (robust vs partial diffs). */
export async function reconcilePrimerAlarms(): Promise<void> {
  const s = await getSettings();
  const existing = await getAllAlarms();
  for (const a of existing) if (a.name.startsWith(PRIMER_ALARM_PREFIX)) chrome.alarms.clear(a.name);
  const now = new Date();
  for (const name of desiredPrimerAlarmNames(s)) {
    chrome.alarms.create(name, { when: computeAlarmWhen(name, now, s, Math.random) });
  }
}

/** Fired from router's onAlarm for any aleph-primer* alarm. */
export async function handlePrimerAlarm(name: string): Promise<void> {
  const s = await getSettings();
  if (!s.primerEnabled) return;
  const now = new Date();
  if (name.startsWith(`${PRIMER_ALARM_PREFIX}-smart-`)) {
    const target = name.slice(`${PRIMER_ALARM_PREFIX}-smart-`.length) as PrimerTarget;
    await runPrimer(target);
    const win = target === "codex" ? await readCodexWindow() : await readClaudeWindow();
    const next = nextSmartFire(new Date(), win.resetAt ?? 0, s.primerOffDays, s.primerActiveHoursEnabled, s.primerActiveStart, s.primerActiveEnd);
    chrome.alarms.create(name, { when: next.fireAt });
    return;
  }
  // scheduled: run all enabled targets, then re-arm for the next occurrence.
  if (s.primerTargetClaude) await runPrimer("claude");
  if (s.primerTargetCodex) await runPrimer("codex");
  chrome.alarms.create(name, { when: computeAlarmWhen(name, now, s, Math.random) });
}
