// ── Cloud sync (Firebase compat, loaded via importScripts in index.ts) ──
// Schema v2: device-scoped usage rollups that ADD across devices, per-key
// LWW settings, manual-override-aware subscriptions. See docs/SYNC.md.
// The compat SDK ships no types into this worker — the `firebase` global and
// the auth/firestore handles derived from it are boundary `any`.
import { dateDaysAgo } from "../shared/dates";
import { filterToDefaults } from "../shared/defaults";
import {
  ADOPTED_FLAG_KEY,
  buildRemoteUsageCache,
  buildRollupDoc,
  chunkOps,
  decideAdoption,
  DEVICE_ID_KEY,
  DIRTY_KEY,
  ECHO_GUARD_KEY,
  isDateKey,
  makeKeyedThrottle,
  mergeSettings,
  mergeSubscriptions,
  PRIMER_LOCK_COOLDOWN_MS,
  primerLockHeld,
  REMOTE_USAGE_KEY,
  rollupDocId,
  SCHEMA_FLAG_KEY,
  SETTINGS_META_KEY,
  SYNC_SCHEMA_VERSION,
  sumUsageDays,
  USAGE_COUNTER_FIELDS,
} from "./syncSchema";
import { enqueueUsageWork, readLocal } from "./usage";

declare const firebase: any;

interface SyncAuthState {
  signedIn: boolean;
  uid: string | null;
  email: string | null;
  lastSyncAt: number | null;
  token?: string;
}

// ── Merge helpers ─────────────────────────────────────────
// Pure, module-scope (unit-testable). Usage-day documents are raw JSON —
// chrome.storage values merged against firestore docs — so fields are read
// defensively through boundary `any` records. Max semantics: these merge the
// LEGACY union docs (and the one-time migration seal) where overlapping data
// must never double-count. Device rollups use syncSchema's ADD helpers.

export function _mergeUsageDay(local: Record<string, any>, remote: Record<string, any>): Record<string, any> {
  const platforms = ["claude", "chatgpt", "gemini"];
  const merged: Record<string, any> = Object.assign({}, remote, local);
  delete merged._lastModified;
  for (const p of platforms) {
    const l = local[p] || {};
    const r = remote[p] || {};
    const day = Object.assign({}, r, l);
    _mergeCounterFields(day, l, r, USAGE_COUNTER_FIELDS);
    day.hours = _mergeHours(l.hours || {}, r.hours || {});
    day.sends = _mergeSends(l.sends || {}, r.sends || {});
    if (!day.sends.total && !day.sends.rtl && !day.sends.totalWords && !day.sends.totalChars) delete day.sends;
    day.timing = _mergeNestedCounters(l.timing || {}, r.timing || {}, ["count", "totalTTFT", "totalThinking", "totalSendToThinking"]);
    if (l.timing?.approximate || r.timing?.approximate) day.timing.approximate = true;
    if (Object.keys(day.timing).length === 0) delete day.timing;
    // Never assign undefined — Firestore set() rejects explicit-undefined
    // field values, which silently killed every migration seal batch.
    const estimateSource = l.estimateSource || r.estimateSource || day.estimateSource;
    if (estimateSource) day.estimateSource = estimateSource;
    else delete day.estimateSource;
    merged[p] = day;
  }
  return merged;
}

export function _mergeCounterFields(target: Record<string, any>, local: Record<string, any>, remote: Record<string, any>, fields: string[]) {
  for (const f of fields) {
    target[f] = Math.max(local[f] || 0, remote[f] || 0);
  }
}

export function _mergeNestedCounters(local: Record<string, any>, remote: Record<string, any>, fields: string[]): Record<string, any> {
  const merged: Record<string, any> = Object.assign({}, remote, local);
  for (const f of fields) {
    const value = Math.max(local[f] || 0, remote[f] || 0);
    if (value > 0) merged[f] = value;
    else delete merged[f];
  }
  return merged;
}

export function _mergeSends(localS: Record<string, any>, remoteS: Record<string, any>) {
  const merged: Record<string, any> = {
    total: Math.max(localS.total || 0, remoteS.total || 0),
    rtl: Math.max(localS.rtl || localS.hebrew || 0, remoteS.rtl || remoteS.hebrew || 0),
    totalWords: Math.max(localS.totalWords || 0, remoteS.totalWords || 0),
    totalChars: Math.max(localS.totalChars || 0, remoteS.totalChars || 0),
  };
  const byHour = _mergeHours(localS.byHour || {}, remoteS.byHour || {});
  if (Object.keys(byHour).length > 0) merged.byHour = byHour;
  return merged;
}

export function _mergeHours(localH: Record<string, number>, remoteH: Record<string, number>): Record<string, number> {
  const merged: Record<string, number> = Object.assign({}, localH);
  for (const h in remoteH) {
    merged[h] = Math.max(merged[h] || 0, remoteH[h]);
  }
  return merged;
}

export const alephSync = (function () {
  // Firebase auth/firestore instances — boundary `any` (compat SDK, untyped).
  let _db: any = null;
  let _auth: any = null;
  let _uid: string | null = null;
  let _signedInHint: boolean | null = null;
  let _lastLightPull = 0;

  const AUTH_KEY = "aleph_sync_auth";
  const LEGACY_QUEUE_KEY = "aleph_sync_queue"; // pre-v2 retry queue — removed at boot
  const DEBOUNCE_MS = 60000;
  const LIGHT_PULL_MS = 5 * 60 * 1000;
  const PULL_WINDOW_DAYS = 14; // dashboard window (today + 2 weeks of charts)
  const CACHE_DAYS = 90; // mirrors local usage retention (cleanup.ts)
  const RETENTION_DAYS = 400; // cloud retention, deleted client-side

  function init(fb: any) {
    _auth = fb.auth();
    _db = fb.firestore();
  }

  function _userDoc() {
    return _db.collection("users").doc(_uid);
  }

  function same(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  // Serializes sync's own storage.local read-modify-writes (dirty set, stamps,
  // echo guard) so concurrent events cannot drop each other's updates.
  let _kvQueue: Promise<unknown> = Promise.resolve();
  function _kv<T>(fn: () => Promise<T>): Promise<T> {
    const run = _kvQueue.catch(() => {}).then(fn);
    _kvQueue = run.catch(() => {});
    return run;
  }

  // ── Device identity ───────────────────────────────────────

  let _deviceIdPromise: Promise<string> | null = null;
  function getDeviceId(): Promise<string> {
    if (!_deviceIdPromise) {
      _deviceIdPromise = (async () => {
        const stored = await readLocal<string | null>(DEVICE_ID_KEY, null);
        if (stored) return stored;
        const id = "dev-" + crypto.randomUUID();
        await chrome.storage.local.set({ [DEVICE_ID_KEY]: id });
        return id;
      })();
    }
    return _deviceIdPromise;
  }

  // ── Auth ──────────────────────────────────────────────────

  async function _getStoredAuth(): Promise<SyncAuthState | null> {
    const result = await chrome.storage.local.get({ [AUTH_KEY]: null });
    return result[AUTH_KEY];
  }

  async function _isSignedInHint(): Promise<boolean> {
    if (_signedInHint == null) {
      const state = await _getStoredAuth();
      _signedInHint = Boolean(state && state.signedIn);
    }
    return _signedInHint;
  }

  function _getIdentityToken(interactive: boolean): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive }, (t) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(t);
      });
    });
  }

  async function signIn(): Promise<{ success: boolean; email?: string; error?: string }> {
    try {
      const token = await _getIdentityToken(true);
      const credential = firebase.auth.GoogleAuthProvider.credential(null, token);
      const result = await _auth.signInWithCredential(credential);
      const user = result.user;
      _uid = user.uid;
      _signedInHint = true;
      _restorePromise = Promise.resolve(); // fresh interactive auth — nothing to restore
      // Token stored so signOut can actually clear the cached identity grant.
      const state: SyncAuthState = { signedIn: true, uid: user.uid, email: user.email, lastSyncAt: null, token };
      await chrome.storage.local.set({ [AUTH_KEY]: state });
      (async () => {
        await ensureAdopted();
        await fullMergeAndSync();
      })().catch(function () {});
      return { success: true, email: user.email };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async function signOut(): Promise<{ success: boolean; error?: string }> {
    try {
      const state = await _getStoredAuth();
      await _auth.signOut();
      if (state && state.token) {
        await chrome.identity.removeCachedAuthToken({ token: state.token });
      }
      _uid = null;
      _signedInHint = false;
      _restorePromise = null;
      _throttle.cancelAll();
      // Keeps: device id, schema/adopted flags, settings stamps, local usage.
      await chrome.storage.local.remove([AUTH_KEY, DIRTY_KEY, ECHO_GUARD_KEY, REMOTE_USAGE_KEY, LEGACY_QUEUE_KEY]);
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  // Single-flight: index boot and router install/startup all funnel into one
  // restore attempt per worker. Transient failures (offline boot) keep the
  // stored auth state — only a credential rejected AFTER a cleared-token
  // retry signs the user out. Only a SUCCESSFUL restore is memoized: a
  // transient failure must not pin the worker into never retrying (the next
  // flush/alarm/sync call gets a fresh attempt).
  let _restorePromise: Promise<void> | null = null;
  function restoreAuth(): Promise<void> {
    if (!_restorePromise) {
      _restorePromise = _restoreAuthOnce()
        .catch(function () {})
        .then(function () {
          if (!_uid) _restorePromise = null;
        });
    }
    return _restorePromise;
  }

  async function _restoreAuthOnce() {
    if (!_auth) return;
    const state = await _getStoredAuth();
    if (!state || !state.signedIn) return;
    let token: string | undefined;
    try {
      token = await _getIdentityToken(false);
      await _signInWithToken(state, token);
      return;
    } catch (e) {
      // The cached identity token may simply be expired — clear and retry once.
      if (token) {
        try { await chrome.identity.removeCachedAuthToken({ token }); } catch (e2) {}
      }
    }
    try {
      const freshToken = await _getIdentityToken(false);
      await _signInWithToken(state, freshToken);
    } catch (e) {
      _uid = null;
      // Credential explicitly rejected → signed out for real. Anything else
      // (network, identity hiccup) keeps the state for the next boot.
      const code = (e as { code?: unknown })?.code;
      if (typeof code === "string" && code.startsWith("auth/")) {
        _signedInHint = false;
        await chrome.storage.local.remove(AUTH_KEY);
      }
    }
  }

  async function _signInWithToken(state: SyncAuthState, token: string | undefined) {
    const credential = firebase.auth.GoogleAuthProvider.credential(null, token);
    const result = await _auth.signInWithCredential(credential);
    _uid = result.user.uid;
    _signedInHint = true;
    const next: SyncAuthState = Object.assign({}, state, { uid: _uid, email: result.user.email || state.email, token });
    await chrome.storage.local.set({ [AUTH_KEY]: next });
  }

  async function getAuthState(): Promise<SyncAuthState> {
    const state = await _getStoredAuth();
    return state || { signedIn: false, uid: null, email: null, lastSyncAt: null };
  }

  // ── Migration / adoption (schema v2) ──────────────────────
  // ensureMigrated runs once per worker boot, after restoreAuth. A device may
  // only claim its local usage as its own rollup baseline ("adopted") when
  // the cloud holds no legacy history; otherwise local data is a max-merged
  // union of every device and must be sealed into the legacy baseline first.

  // Memoized only once adoption is settled while signed in — a run without
  // auth (restore failed transiently) or with a failed seal re-runs on the
  // next readiness check, so a worker that recovers auth mid-life still
  // migrates without waiting for the next boot.
  let _migratePromise: Promise<void> | null = null;
  function ensureMigrated(): Promise<void> {
    if (!_migratePromise) {
      _migratePromise = _ensureMigratedOnce()
        .catch(function () {})
        .then(function () {
          if (!_uid || !_adopted) _migratePromise = null;
        });
    }
    return _migratePromise;
  }

  async function _ensureMigratedOnce() {
    if (_uid) {
      await ensureAdopted();
      return;
    }
    const schema = await readLocal<number | null>(SCHEMA_FLAG_KEY, null);
    if (schema !== SYNC_SCHEMA_VERSION) {
      await chrome.storage.local.set({ [SCHEMA_FLAG_KEY]: SYNC_SCHEMA_VERSION });
    }
  }

  let _adopted = false; // memo — the flag never reverts
  async function _isAdopted(): Promise<boolean> {
    if (_adopted) return true;
    _adopted = Boolean(await readLocal<boolean>(ADOPTED_FLAG_KEY, false));
    return _adopted;
  }

  let _adoptionPromise: Promise<void> | null = null;
  function ensureAdopted(): Promise<void> {
    if (!_adoptionPromise) {
      _adoptionPromise = _ensureAdoptedOnce()
        .catch(function () {})
        .finally(function () { _adoptionPromise = null; });
    }
    return _adoptionPromise;
  }

  async function _ensureAdoptedOnce() {
    if (!_uid || !_db) return;
    if (await _isAdopted()) return;
    const probe = await _userDoc().collection("usage").limit(1).get();
    const plan = decideAdoption({ adopted: false, legacyEmpty: probe.empty });
    if (plan.action === "adopt-fresh") {
      // No legacy history: local usage is provably this device's own.
      // History upload happens via the sign-in full sync.
      _adopted = true;
      await chrome.storage.local.set({ [ADOPTED_FLAG_KEY]: true, [SCHEMA_FLAG_KEY]: SYNC_SCHEMA_VERSION });
    } else if (plan.action === "seal-and-adopt") {
      // Serialized behind the usage queue so a tracker message can never
      // interleave with the read-and-reset of the usage docs.
      await enqueueUsageWork(() => _sealLegacyAndReset());
    }
  }

  // Seal: run the legacy merge one final time (exactly the old fullMergeAndSync
  // semantics) so cloud legacy ⊇ local union — then atomically seed the remote
  // cache from the merged union, reset local usage docs to own-only, and mark
  // adopted. If any cloud step fails, no flag is set and the next boot retries.
  async function _sealLegacyAndReset() {
    const snap = await _userDoc().collection("usage").get();
    const remoteByDate: Record<string, any> = {};
    snap.forEach(function (doc: any) { remoteByDate[doc.id] = doc.data(); });

    const allLocal = await chrome.storage.local.get(null);
    const localKeys = Object.keys(allLocal).filter(function (k) {
      return k.startsWith("usage_") && isDateKey(k.slice("usage_".length));
    });

    const cachePrune = dateDaysAgo(CACHE_DAYS);
    const cache: Record<string, any> = {};
    const writes: Array<{ date: string; payload: Record<string, any> }> = [];
    const dates = new Set<string>([
      ...localKeys.map(function (k) { return k.slice("usage_".length); }),
      ...Object.keys(remoteByDate).filter(isDateKey),
    ]);
    for (const date of dates) {
      const local = allLocal["usage_" + date] || {};
      const remote = Object.assign({}, remoteByDate[date]);
      delete remote._lastModified;
      const merged = _mergeUsageDay(local, remote);
      if (date >= cachePrune) {
        const cleaned = sumUsageDays(merged, null); // normalize, drop empty platforms
        if (Object.keys(cleaned).length > 0) cache[date] = cleaned;
      }
      // Remote-only dates are already in the cloud — only local data needs sealing.
      if (allLocal["usage_" + date] != null) writes.push({ date, payload: merged });
    }

    for (const chunk of chunkOps(writes)) {
      const batch = _db.batch();
      for (const write of chunk) {
        const payload = Object.assign({}, write.payload, {
          _lastModified: firebase.firestore.FieldValue.serverTimestamp(),
        });
        batch.set(_userDoc().collection("usage").doc(write.date), payload, { merge: true });
      }
      await batch.commit();
    }

    const localSwap: Record<string, unknown> = {
      [REMOTE_USAGE_KEY]: cache,
      [SCHEMA_FLAG_KEY]: SYNC_SCHEMA_VERSION,
      [ADOPTED_FLAG_KEY]: true,
    };
    for (const key of localKeys) localSwap[key] = {};
    await chrome.storage.local.set(localSwap);
    _adopted = true;
  }

  // Push/pull readiness: auth restored AND migration/adoption settled.
  async function _ready() {
    await restoreAuth();
    await ensureMigrated();
  }

  // ── Push ──────────────────────────────────────────────────
  // Leading+trailing 60s throttle per key; the key is marked dirty before the
  // throttle so an MV3 worker death between touch and trailing fire is
  // recovered by the boot/alarm flushDirty. Values are never queued — every
  // push reads the CURRENT local state (full-set rollups are idempotent).

  function _markDirty(key: string): Promise<void> {
    return _kv(async () => {
      const dirty = await readLocal<string[]>(DIRTY_KEY, []);
      if (dirty.includes(key)) return;
      dirty.push(key);
      await chrome.storage.local.set({ [DIRTY_KEY]: dirty });
    });
  }

  function _clearDirty(key: string): Promise<void> {
    return _kv(async () => {
      const dirty = await readLocal<string[]>(DIRTY_KEY, []);
      const next = dirty.filter(function (k) { return k !== key; });
      if (next.length !== dirty.length) await chrome.storage.local.set({ [DIRTY_KEY]: next });
    });
  }

  const _throttle = makeKeyedThrottle(DEBOUNCE_MS, function (key) {
    _pushKeyNow(key).catch(function () {});
  });

  function _isSyncedKey(key: string): boolean {
    return key === "aleph_settings" || key === "insights_subscriptions" || key.startsWith("usage_");
  }

  function maybePush(key: string) {
    if (!_isSyncedKey(key)) return;
    (async () => {
      if (!(await _isSignedInHint())) return;
      await _markDirty(key);
      _throttle.touch(key);
    })().catch(function () {});
  }

  // Pushes the current local state for one key; clears its dirty mark only
  // after the cloud write succeeds (or when there is provably nothing to push).
  async function _pushKeyNow(key: string) {
    await _ready();
    if (!_uid) return; // signed out — stays dirty, drained at sign-in
    let pushed = false;
    if (key.startsWith("usage_")) pushed = await _pushUsageRollup(key);
    else if (key === "insights_subscriptions") pushed = await syncSubscriptions();
    else if (key === "aleph_settings") pushed = await syncSettings();
    if (pushed) {
      await _clearDirty(key);
      _updateLastSyncTime();
    }
  }

  async function _pushUsageRollup(key: string): Promise<boolean> {
    const date = key.slice("usage_".length);
    if (!isDateKey(date)) return true; // junk key — nothing to sync
    if (!(await _isAdopted())) return false; // pre-seal: never upload union data
    const day = await readLocal<Record<string, any> | null>(key, null);
    const deviceId = await getDeviceId();
    const doc = buildRollupDoc(deviceId, date, day, chrome.runtime.getManifest().version, new Date().getTimezoneOffset());
    if (!doc) return true; // empty day — nothing to push
    const payload = Object.assign({}, doc, { updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    await _userDoc().collection("usageRollups").doc(rollupDocId(deviceId, date)).set(payload);
    return true;
  }

  // ── Settings (meta/settings2, per-key LWW) ────────────────

  function onSettingsChanged(changes: Record<string, chrome.storage.StorageChange>) {
    (async () => {
      const changedKeys = Object.keys(filterToDefaults(changes));
      if (changedKeys.length === 0) return;
      // Echo guard: a change identical to a value we just applied from the
      // cloud is the apply echoing back — consume the guard entry, don't
      // re-stamp or re-push it.
      const realKeys = await _kv(async () => {
        const guard = await readLocal<Record<string, unknown>>(ECHO_GUARD_KEY, {});
        let guardChanged = false;
        const real: string[] = [];
        for (const key of changedKeys) {
          if (key in guard && same(guard[key], changes[key].newValue)) {
            delete guard[key];
            guardChanged = true;
          } else {
            real.push(key);
          }
        }
        if (guardChanged) await chrome.storage.local.set({ [ECHO_GUARD_KEY]: guard });
        return real;
      });
      if (realKeys.length === 0) return;
      // Stamps are maintained even while signed out — they are the local
      // recency record the first sign-in merge relies on.
      await _kv(async () => {
        const stamps = await readLocal<Record<string, number>>(SETTINGS_META_KEY, {});
        const now = Date.now();
        for (const key of realKeys) stamps[key] = now;
        await chrome.storage.local.set({ [SETTINGS_META_KEY]: stamps });
      });
      maybePush("aleph_settings");
    })().catch(function () {});
  }

  // Bidirectional convergence: merge cloud and local per key, apply remote
  // wins locally (echo-guarded), push when the merged doc differs from the
  // cloud. Returns true when the cloud is up to date.
  async function syncSettings(): Promise<boolean> {
    if (!_uid) return false;
    const metaCol = _userDoc().collection("meta");
    const snap = await metaCol.doc("settings2").get();
    let remote: Record<string, any> | null = snap.exists ? snap.data() : null;
    if (!remote) {
      // One-time upgrade path: fall back to the legacy flat settings doc.
      const legacySnap = await metaCol.doc("settings").get();
      if (legacySnap.exists) remote = legacySnap.data();
    }
    const localValues = await chrome.storage.sync.get(null);
    const stamps = await readLocal<Record<string, number>>(SETTINGS_META_KEY, {});
    const result = mergeSettings(localValues, stamps, remote);

    const applyKeys = Object.keys(result.applyToLocal);
    if (applyKeys.length > 0) {
      // Guard BEFORE the sync.set — the onChanged echo may arrive in a fresh
      // worker, so the guard is persisted, not in-memory.
      await _kv(async () => {
        const guard = await readLocal<Record<string, unknown>>(ECHO_GUARD_KEY, {});
        Object.assign(guard, result.applyToLocal);
        await chrome.storage.local.set({ [ECHO_GUARD_KEY]: guard });
      });
      await chrome.storage.sync.set(result.applyToLocal);
    }
    await _kv(async () => {
      await chrome.storage.local.set({ [SETTINGS_META_KEY]: result.stamps });
    });
    if (result.shouldPush) {
      await metaCol.doc("settings2").set({
        schemaVersion: SYNC_SCHEMA_VERSION,
        values: result.values,
        updatedAtByKey: result.stamps,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    }
    return true;
  }

  // ── Subscriptions (meta/subscriptions) ────────────────────

  async function syncSubscriptions(): Promise<boolean> {
    if (!_uid) return false;
    const docRef = _userDoc().collection("meta").doc("subscriptions");
    const snap = await docRef.get();
    const remote: Record<string, any> = snap.exists ? snap.data() : {};
    delete remote._lastModified;
    const local = await readLocal<Record<string, any>>("insights_subscriptions", {});
    const merged = mergeSubscriptions(local, remote);
    if (!same(merged, local)) {
      // Direct set — writeLocal would loop the merge back through maybePush.
      await chrome.storage.local.set({ insights_subscriptions: merged });
    }
    if (!same(merged, remote)) {
      await docRef.set(merged);
    }
    return true;
  }

  // ── Pull: remote usage cache ──────────────────────────────
  // cache[date] = legacy baseline ADD other devices' rollups (disjoint by
  // construction after the seal). Written directly (never via writeLocal).

  async function _writeUsageCache(cache: Record<string, any>) {
    const prune = dateDaysAgo(CACHE_DAYS);
    for (const date in cache) {
      if (date < prune) delete cache[date];
    }
    await chrome.storage.local.set({ [REMOTE_USAGE_KEY]: cache });
  }

  function _rollupsFromSnap(snap: any): Array<{ deviceId: string; date: string; platforms: Record<string, any> }> {
    const rollups: Array<{ deviceId: string; date: string; platforms: Record<string, any> }> = [];
    snap.forEach(function (doc: any) {
      const data = doc.data() || {};
      rollups.push({ deviceId: data.deviceId, date: data.date, platforms: data.platforms });
    });
    return rollups;
  }

  // Refreshes the dashboard window (14 days) — cheap enough for the popup
  // open path and the 20-minute alarm; full history rebuilds happen in
  // fullMergeAndSync. Throttled in-memory (worker lifetime).
  async function lightweightPull() {
    await _ready();
    if (!_uid) return;
    if (Date.now() - _lastLightPull < LIGHT_PULL_MS) return;
    _lastLightPull = Date.now();
    const cutoff = dateDaysAgo(PULL_WINDOW_DAYS);
    const deviceId = await getDeviceId();
    const rollupSnap = await _userDoc().collection("usageRollups").where("date", ">=", cutoff).get();
    const legacySnap = await _userDoc().collection("usage")
      .where(firebase.firestore.FieldPath.documentId(), ">=", cutoff).get();
    const legacyByDate: Record<string, any> = {};
    legacySnap.forEach(function (doc: any) { legacyByDate[doc.id] = doc.data(); });
    const fresh = buildRemoteUsageCache(_rollupsFromSnap(rollupSnap), legacyByDate, deviceId, cutoff);

    const cache = await readLocal<Record<string, any>>(REMOTE_USAGE_KEY, {});
    for (const date in cache) {
      if (date >= cutoff) delete cache[date]; // window is replaced wholesale
    }
    Object.assign(cache, fresh);
    await _writeUsageCache(cache);
    await syncSettings();
    await syncSubscriptions();
    _updateLastSyncTime();
  }

  // ── Full sync (sign-in / manual "sync now") ───────────────

  async function fullMergeAndSync() {
    await _ready();
    if (!_uid) return;
    await ensureAdopted();
    if (!(await _isAdopted())) return; // seal failed (offline) — next boot retries

    const deviceId = await getDeviceId();
    const rollupSnap = await _userDoc().collection("usageRollups").get();
    const legacySnap = await _userDoc().collection("usage").get();
    const legacyByDate: Record<string, any> = {};
    legacySnap.forEach(function (doc: any) { legacyByDate[doc.id] = doc.data(); });

    // Rebuild the remote cache from the full history.
    const cache = buildRemoteUsageCache(_rollupsFromSnap(rollupSnap), legacyByDate, deviceId, dateDaysAgo(CACHE_DAYS));
    await _writeUsageCache(cache);

    // Push every local day as this device's rollup (chunked full-set writes).
    const allLocal = await chrome.storage.local.get(null);
    const version = chrome.runtime.getManifest().version;
    const tz = new Date().getTimezoneOffset();
    const rollupWrites: Array<{ id: string; payload: Record<string, any> }> = [];
    for (const key of Object.keys(allLocal)) {
      if (!key.startsWith("usage_")) continue;
      const date = key.slice("usage_".length);
      if (!isDateKey(date)) continue;
      const doc = buildRollupDoc(deviceId, date, allLocal[key], version, tz);
      if (!doc) continue;
      rollupWrites.push({
        id: rollupDocId(deviceId, date),
        payload: Object.assign({}, doc, { updatedAt: firebase.firestore.FieldValue.serverTimestamp() }),
      });
    }

    // Retention: drop cloud docs older than RETENTION_DAYS (any device's).
    const retentionCutoff = dateDaysAgo(RETENTION_DAYS);
    const deletions: any[] = [];
    rollupSnap.forEach(function (doc: any) {
      const date = (doc.data() || {}).date;
      if (typeof date === "string" && date < retentionCutoff) deletions.push(doc.ref);
    });
    legacySnap.forEach(function (doc: any) {
      if (isDateKey(doc.id) && doc.id < retentionCutoff) deletions.push(doc.ref);
    });

    for (const chunk of chunkOps(rollupWrites)) {
      const batch = _db.batch();
      for (const write of chunk) {
        batch.set(_userDoc().collection("usageRollups").doc(write.id), write.payload);
      }
      await batch.commit();
    }
    for (const chunk of chunkOps(deletions)) {
      const batch = _db.batch();
      for (const ref of chunk) batch.delete(ref);
      await batch.commit();
    }

    await syncSettings();
    await syncSubscriptions();
    await _kv(async () => {
      await chrome.storage.local.remove(LEGACY_QUEUE_KEY);
      const dirty = await readLocal<string[]>(DIRTY_KEY, []);
      // Everything just pushed — only non-usage keys could still be pending.
      const next = dirty.filter(function (k) { return !k.startsWith("usage_"); });
      if (next.length !== dirty.length) await chrome.storage.local.set({ [DIRTY_KEY]: next });
    });
    _updateLastSyncTime();
  }

  // ── Dirty flush (boot, alarm, sign-in) ────────────────────

  let _flushPromise: Promise<void> | null = null;
  function flushDirty(): Promise<void> {
    if (!_flushPromise) {
      _flushPromise = _flushDirtyOnce()
        .catch(function () {})
        .finally(function () { _flushPromise = null; });
    }
    return _flushPromise;
  }

  async function _flushDirtyOnce() {
    await _ready();
    // The pre-v2 value queue is superseded by the dirty-key set.
    await chrome.storage.local.remove(LEGACY_QUEUE_KEY);
    if (!_uid) return;
    const dirty = await readLocal<string[]>(DIRTY_KEY, []);
    for (const key of dirty) {
      await _pushKeyNow(key);
    }
  }

  // ── Helpers ───────────────────────────────────────────────

  async function _updateLastSyncTime() {
    try {
      const result = await chrome.storage.local.get({ [AUTH_KEY]: null });
      const state: SyncAuthState | null = result[AUTH_KEY];
      if (state) {
        state.lastSyncAt = Date.now();
        await chrome.storage.local.set({ [AUTH_KEY]: state });
      }
    } catch (e) {}
  }

  // Cross-device dedup: claim this target's prime for the current window so two
  // signed-in devices don't both send. Fail-open (never blocks priming on error)
  // and a no-op when signed out. skip-if-active stays the primary safety net.
  async function tryClaimPrimerLock(target: string): Promise<boolean> {
    if (!_uid) return true;
    try {
      const deviceId = await getDeviceId();
      const ref = _userDoc().collection("meta").doc("primerLock");
      return await _db.runTransaction(async (tx: any) => {
        const snap = await tx.get(ref);
        const data = snap.exists ? snap.data() : {};
        if (primerLockHeld(data?.[target], Date.now(), PRIMER_LOCK_COOLDOWN_MS)) return false;
        tx.set(ref, { [target]: { at: Date.now(), device: deviceId } }, { merge: true });
        return true;
      });
    } catch (e) {
      return true;
    }
  }

  return {
    init: init,
    signIn: signIn,
    signOut: signOut,
    restoreAuth: restoreAuth,
    getAuthState: getAuthState,
    maybePush: maybePush,
    onSettingsChanged: onSettingsChanged,
    ensureMigrated: ensureMigrated,
    flushDirty: flushDirty,
    lightweightPull: lightweightPull,
    fullMergeAndSync: fullMergeAndSync,
    tryClaimPrimerLock: tryClaimPrimerLock,
  };
})();
