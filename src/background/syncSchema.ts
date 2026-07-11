import { DEFAULTS, filterToDefaults } from "../shared/defaults";

// ── Sync schema v2: pure helpers ─────────────────────────
// Cloud layout, doc shapes, and merge semantics for device-scoped sync.
// Pure module (no chrome.*, no firebase) — unit-tested directly. Cloud and
// storage payloads are raw JSON boundaries, read defensively through `any`.

export const SYNC_SCHEMA_VERSION = 2;

// chrome.storage.local keys owned by sync (see docs/SYNC.md).
export const REMOTE_USAGE_KEY = "aleph_remote_usage";
export const DEVICE_ID_KEY = "aleph_device_id";
export const SCHEMA_FLAG_KEY = "aleph_sync_schema";
export const ADOPTED_FLAG_KEY = "aleph_sync_adopted";
export const DIRTY_KEY = "aleph_sync_dirty";
export const SETTINGS_META_KEY = "aleph_settings_meta";
export const ECHO_GUARD_KEY = "aleph_sync_echo";

// Counter fields carried by a platform-day. Single source for both merge
// directions: max (legacy union docs) and add (device rollups).
export const USAGE_COUNTER_FIELDS = [
  "totalSeconds", "messageCount",
  "tokensIn", "tokensOut",
  "textTokensIn", "textTokensOut",
  "imageTokensIn", "imageTokensOut",
  "fileTokensIn", "fileTokensOut",
  "imageCountIn", "imageCountOut",
  "fileCountIn", "fileCountOut",
];

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateKey(value: string): boolean {
  return DATE_KEY_RE.test(value);
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function addHourMaps(a: unknown, b: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const src of [asRecord(a), asRecord(b)]) {
    for (const h in src) out[h] = (out[h] || 0) + num(src[h]);
  }
  return out;
}

// `rtl ?? hebrew` mirrors normalizeSends' legacy fallback.
function rtlCount(sends: Record<string, any>): number {
  return num(sends.rtl ?? sends.hebrew);
}

function sumSends(a: unknown, b: unknown): Record<string, any> | undefined {
  if (a == null && b == null) return undefined;
  const x = asRecord(a);
  const y = asRecord(b);
  const sends: Record<string, any> = {
    total: num(x.total) + num(y.total),
    rtl: rtlCount(x) + rtlCount(y),
    totalWords: num(x.totalWords) + num(y.totalWords),
    totalChars: num(x.totalChars) + num(y.totalChars),
  };
  if (!sends.total && !sends.rtl && !sends.totalWords && !sends.totalChars) return undefined;
  const byHour = addHourMaps(x.byHour, y.byHour);
  if (Object.keys(byHour).length > 0) sends.byHour = byHour;
  return sends;
}

function sumTiming(a: unknown, b: unknown): Record<string, any> | undefined {
  if (a == null && b == null) return undefined;
  const x = asRecord(a);
  const y = asRecord(b);
  const timing: Record<string, any> = {
    count: num(x.count) + num(y.count),
    totalTTFT: num(x.totalTTFT) + num(y.totalTTFT),
    totalThinking: num(x.totalThinking) + num(y.totalThinking),
    totalSendToThinking: num(x.totalSendToThinking) + num(y.totalSendToThinking),
  };
  if (!timing.count && !timing.totalTTFT && !timing.totalThinking && !timing.totalSendToThinking) return undefined;
  if (x.approximate || y.approximate) timing.approximate = true;
  return timing;
}

// Elementwise ADD of two platform-day records (device rollups cover disjoint
// activity, so counters add — unlike the legacy max-merge in sync.ts).
// Unknown extra fields pass through, `a` winning. Returns undefined when both
// sides are empty.
export function sumPlatformDays(a: unknown, b: unknown): Record<string, any> | undefined {
  if (a == null && b == null) return undefined;
  const x = asRecord(a);
  const y = asRecord(b);
  if (Object.keys(x).length === 0 && Object.keys(y).length === 0) return undefined;
  const out: Record<string, any> = Object.assign({}, y, x);
  for (const f of USAGE_COUNTER_FIELDS) out[f] = num(x[f]) + num(y[f]);
  out.hours = addHourMaps(x.hours, y.hours);
  const sends = sumSends(x.sends, y.sends);
  if (sends) out.sends = sends; else delete out.sends;
  const timing = sumTiming(x.timing, y.timing);
  if (timing) out.timing = timing; else delete out.timing;
  const estimateSource = x.estimateSource || y.estimateSource;
  if (estimateSource) out.estimateSource = estimateSource; else delete out.estimateSource;
  return out;
}

// ADD across whole usage-day docs (platform → platform-day). Strips the
// Firestore _lastModified leftover from legacy docs.
export function sumUsageDays(a: unknown, b: unknown): Record<string, any> {
  const x = asRecord(a);
  const y = asRecord(b);
  const out: Record<string, any> = {};
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  keys.delete("_lastModified");
  for (const k of keys) {
    const day = sumPlatformDays(x[k], y[k]);
    if (day) out[k] = day;
  }
  return out;
}

function platformDayHasData(day: Record<string, any>): boolean {
  for (const f of USAGE_COUNTER_FIELDS) {
    if (num(day[f]) > 0) return true;
  }
  if (Object.keys(asRecord(day.hours)).length > 0) return true;
  return day.sends != null || day.timing != null;
}

// ── Device rollup docs: users/{uid}/usageRollups/{deviceId}_{date} ──

export interface RollupDoc {
  schemaVersion: number;
  deviceId: string;
  date: string; // YYYY-MM-DD
  tzOffsetMinutes: number; // raw Date#getTimezoneOffset() — positive = behind UTC
  appVersion: string;
  platforms: Record<string, Record<string, any>>;
}

export function rollupDocId(deviceId: string, date: string): string {
  return deviceId + "_" + date;
}

// Builds this device's rollup doc from its local usage-day doc. Returns null
// when the day holds no activity (post-reset `{}` days are never pushed).
export function buildRollupDoc(
  deviceId: string,
  date: string,
  usageDay: unknown,
  appVersion: string,
  tzOffsetMinutes: number,
): RollupDoc | null {
  const platforms: Record<string, Record<string, any>> = {};
  const day = asRecord(usageDay);
  for (const p in day) {
    if (p === "_lastModified") continue;
    const platformDay = asRecord(day[p]);
    if (platformDayHasData(platformDay)) platforms[p] = platformDay;
  }
  if (Object.keys(platforms).length === 0) return null;
  return { schemaVersion: SYNC_SCHEMA_VERSION, deviceId, date, tzOffsetMinutes, appVersion, platforms };
}

// ── Remote usage cache: aleph_remote_usage ───────────────
// cache[date] = legacy cloud baseline ADD sum of OTHER devices' rollups.
// Legacy and rollups cover disjoint periods per device (seal-before-reset
// migration), so plain addition is exact. Dates older than pruneBeforeDate
// are dropped (mirrors the 90-day local retention).
export function buildRemoteUsageCache(
  rollups: Array<{ deviceId?: string; date?: string; platforms?: unknown }>,
  legacyByDate: Record<string, unknown>,
  ownDeviceId: string,
  pruneBeforeDate: string,
): Record<string, Record<string, any>> {
  const out: Record<string, Record<string, any>> = {};
  for (const [date, day] of Object.entries(asRecord(legacyByDate))) {
    if (!isDateKey(date) || date < pruneBeforeDate) continue;
    const cleaned = sumUsageDays(day, null);
    if (Object.keys(cleaned).length > 0) out[date] = cleaned;
  }
  for (const rollup of rollups || []) {
    if (!rollup || rollup.deviceId === ownDeviceId) continue;
    const date = String(rollup.date || "");
    if (!isDateKey(date) || date < pruneBeforeDate) continue;
    const day = sumUsageDays(out[date], rollup.platforms);
    if (Object.keys(day).length > 0) out[date] = day;
  }
  return out;
}

// ── Settings doc v2: users/{uid}/meta/settings2 ──────────

export interface SettingsDocV2 {
  schemaVersion: number;
  values: Record<string, unknown>; // DEFAULTS-filtered, present keys only
  updatedAtByKey: Record<string, number>; // epochMs client clocks (documented LWW tradeoff)
}

export interface SettingsMergeResult {
  values: Record<string, unknown>;
  stamps: Record<string, number>;
  applyToLocal: Record<string, unknown>; // keys whose local value must change
  shouldPush: boolean; // merged doc differs from what the cloud holds
}

// Per-key last-write-wins. `remote` may be a v2 doc, a legacy flat settings
// doc (treated as values stamped 0), or null (nothing in the cloud yet).
// Unstamped ties keep the local value, matching the device the user is on.
export function mergeSettings(
  localValuesRaw: Record<string, unknown>,
  localStampsRaw: Record<string, number>,
  remote: Record<string, any> | null,
): SettingsMergeResult {
  const localValues = filterToDefaults(asRecord(localValuesRaw));
  const localStamps = asRecord(localStampsRaw);
  let remoteValues: Record<string, unknown> = {};
  let remoteStamps: Record<string, any> = {};
  let legacyShape = false;
  if (remote != null) {
    if (remote.values && typeof remote.values === "object") {
      remoteValues = filterToDefaults(asRecord(remote.values));
      remoteStamps = asRecord(remote.updatedAtByKey);
    } else {
      remoteValues = filterToDefaults(remote);
      legacyShape = true;
    }
  }

  const values: Record<string, unknown> = {};
  const stamps: Record<string, number> = {};
  const applyToLocal: Record<string, unknown> = {};
  let localWon = false;
  for (const key of Object.keys(DEFAULTS)) {
    const inLocal = key in localValues;
    const inRemote = key in remoteValues;
    if (!inLocal && !inRemote) continue;
    const localTs = num(localStamps[key]);
    const remoteTs = num(remoteStamps[key]);
    const useLocal = inLocal && (!inRemote || localTs >= remoteTs);
    if (useLocal) {
      values[key] = localValues[key];
      if (localTs) stamps[key] = localTs;
      if (!inRemote || !same(remoteValues[key], localValues[key]) || remoteTs !== localTs) localWon = true;
    } else {
      values[key] = remoteValues[key];
      if (remoteTs) stamps[key] = remoteTs;
      if (!inLocal || !same(localValues[key], remoteValues[key])) applyToLocal[key] = remoteValues[key];
    }
  }
  return { values, stamps, applyToLocal, shouldPush: localWon || legacyShape };
}

// ── Subscriptions merge: users/{uid}/meta/subscriptions ──
// Per platform: a manual override beats auto-detection; otherwise the newer
// detection wins (tie keeps local).
export function mergeSubscriptions(local: unknown, remote: unknown): Record<string, any> {
  const x = asRecord(local);
  const y = asRecord(remote);
  const out: Record<string, any> = {};
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  keys.delete("_lastModified");
  for (const p of keys) {
    const l = x[p];
    const r = y[p];
    if (l == null || typeof l !== "object") { out[p] = r; continue; }
    if (r == null || typeof r !== "object") { out[p] = l; continue; }
    const localManual = l.manualOverride === true;
    const remoteManual = r.manualOverride === true;
    if (localManual !== remoteManual) out[p] = localManual ? l : r;
    else out[p] = num(r.detectedAt) > num(l.detectedAt) ? r : l;
  }
  return out;
}

// ── Adoption: when does this device start owning a rollup baseline? ──
// Only consulted while signed in. Non-adopted local data may be a max-merged
// union of every device (old sync wrote merged docs back to local), so it can
// only be claimed as this device's own when the cloud has no legacy history.
export type AdoptionPlan = { action: "none" } | { action: "seal-and-adopt" } | { action: "adopt-fresh" };

export function decideAdoption(input: { adopted: boolean; legacyEmpty: boolean }): AdoptionPlan {
  if (input.adopted) return { action: "none" };
  return input.legacyEmpty ? { action: "adopt-fresh" } : { action: "seal-and-adopt" };
}

// ── Keyed throttle: leading fire + trailing flush ────────
// The caller marks keys dirty before touch() and clears them after a
// successful push, so a trailing timer lost to MV3 worker death is recovered
// by the boot/alarm dirty flush.
export interface KeyedThrottle {
  touch(key: string): void;
  cancelAll(): void;
}

export function makeKeyedThrottle(periodMs: number, onFire: (key: string) => void): KeyedThrottle {
  const lastFired: Record<string, number> = {};
  const timers: Record<string, ReturnType<typeof setTimeout>> = {};
  const fire = (key: string) => {
    lastFired[key] = Date.now();
    onFire(key);
  };
  return {
    touch(key: string) {
      if (timers[key] != null) return; // trailing flush already scheduled
      const elapsed = Date.now() - (lastFired[key] || 0);
      if (elapsed >= periodMs) {
        fire(key);
        return;
      }
      timers[key] = setTimeout(() => {
        delete timers[key];
        fire(key);
      }, periodMs - elapsed);
    },
    cancelAll() {
      for (const key in timers) {
        clearTimeout(timers[key]);
        delete timers[key];
      }
    },
  };
}

// Firestore batches cap at 500 ops — split with headroom.
export function chunkOps<T>(ops: T[], size = 450): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < ops.length; i += size) chunks.push(ops.slice(i, i + size));
  return chunks;
}

// ── Primer cross-device lock ─────────────────────────────
// Best-effort dedup so multiple signed-in devices don't all prime the same
// window. skip-if-active is the real safety net; this only closes the brief
// race before a prime registers in the account's window state. The cooldown
// must exceed the max jitter spread (120s) so a device that fired a bit later
// still sees the claim.
export const PRIMER_LOCK_COOLDOWN_MS = 5 * 60 * 1000;

export function primerLockHeld(claim: unknown, now: number, cooldownMs: number): boolean {
  const at = num(asRecord(claim).at);
  return at > 0 && now - at < cooldownMs;
}
