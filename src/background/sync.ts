// ── Cloud sync (Firebase compat, loaded via importScripts in index.ts) ──
// The compat SDK ships no types into this worker — the `firebase` global and
// the auth/firestore handles derived from it are boundary `any`.
declare const firebase: any;

interface SyncAuthState {
  signedIn: boolean;
  uid: string | null;
  email: string | null;
  lastSyncAt: number | null;
  token?: string;
}

interface RetryQueueEntry {
  key: string;
  value: unknown;
  ts: number;
}

// ── Merge helpers ─────────────────────────────────────────
// Pure, module-scope (unit-testable). Usage-day documents are raw JSON —
// chrome.storage values merged against firestore docs — so fields are read
// defensively through boundary `any` records.

export function _mergeUsageDay(local: Record<string, any>, remote: Record<string, any>): Record<string, any> {
  const platforms = ["claude", "chatgpt", "gemini"];
  const merged: Record<string, any> = Object.assign({}, remote, local);
  delete merged._lastModified;
  for (const p of platforms) {
    const l = local[p] || {};
    const r = remote[p] || {};
    const day = Object.assign({}, r, l);
    _mergeCounterFields(day, l, r, [
      "totalSeconds", "messageCount",
      "tokensIn", "tokensOut",
      "textTokensIn", "textTokensOut",
      "imageTokensIn", "imageTokensOut",
      "fileTokensIn", "fileTokensOut",
      "imageCountIn", "imageCountOut",
      "fileCountIn", "fileCountOut",
    ]);
    day.hours = _mergeHours(l.hours || {}, r.hours || {});
    day.sends = _mergeSends(l.sends || {}, r.sends || {});
    if (!day.sends.total && !day.sends.rtl && !day.sends.totalWords && !day.sends.totalChars) delete day.sends;
    day.timing = _mergeNestedCounters(l.timing || {}, r.timing || {}, ["count", "totalTTFT", "totalThinking", "totalSendToThinking"]);
    if (l.timing?.approximate || r.timing?.approximate) day.timing.approximate = true;
    if (Object.keys(day.timing).length === 0) delete day.timing;
    day.estimateSource = l.estimateSource || r.estimateSource || day.estimateSource;
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
  return {
    total: Math.max(localS.total || 0, remoteS.total || 0),
    rtl: Math.max(localS.rtl || localS.hebrew || 0, remoteS.rtl || remoteS.hebrew || 0),
    totalWords: Math.max(localS.totalWords || 0, remoteS.totalWords || 0),
    totalChars: Math.max(localS.totalChars || 0, remoteS.totalChars || 0),
  };
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
  const _debounce: Record<string, number> = {};
  const DEBOUNCE_MS = 60000;
  const AUTH_KEY = "aleph_sync_auth";
  const QUEUE_KEY = "aleph_sync_queue";

  function init(fb: any) {
    _auth = fb.auth();
    _db = fb.firestore();
  }

  // ── Auth ──────────────────────────────────────────────────

  async function signIn(): Promise<{ success: boolean; email?: string; error?: string }> {
    try {
      const token = await new Promise<string | undefined>((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive: true }, (t) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(t);
        });
      });
      const credential = firebase.auth.GoogleAuthProvider.credential(null, token);
      const result = await _auth.signInWithCredential(credential);
      const user = result.user;
      _uid = user.uid;
      const state: SyncAuthState = { signedIn: true, uid: user.uid, email: user.email, lastSyncAt: null };
      await chrome.storage.local.set({ [AUTH_KEY]: state });
      fullMergeAndSync().catch(function () {});
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
      await chrome.storage.local.remove([AUTH_KEY, QUEUE_KEY]);
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async function restoreAuth() {
    try {
      const state = await _getStoredAuth();
      if (!state || !state.signedIn) return;
      const token = await new Promise<string | undefined>((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive: false }, (t) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(t);
        });
      });
      const credential = firebase.auth.GoogleAuthProvider.credential(null, token);
      const result = await _auth.signInWithCredential(credential);
      _uid = result.user.uid;
    } catch (e) {
      _uid = null;
      await chrome.storage.local.remove(AUTH_KEY);
    }
  }

  async function getAuthState(): Promise<SyncAuthState> {
    const state = await _getStoredAuth();
    return state || { signedIn: false, uid: null, email: null, lastSyncAt: null };
  }

  async function _getStoredAuth(): Promise<SyncAuthState | null> {
    const result = await chrome.storage.local.get({ [AUTH_KEY]: null });
    return result[AUTH_KEY];
  }

  // ── Push ──────────────────────────────────────────────────

  function maybePush(key: string, value: unknown) {
    if (!_uid) return;
    const now = Date.now();
    if (_debounce[key] && (now - _debounce[key]) < DEBOUNCE_MS) return;
    _debounce[key] = now;

    if (key.startsWith("usage_")) {
      const dateKey = key.replace("usage_", "");
      _pushUsageDay(dateKey, value).catch(function () { _queueRetry(key, value); });
    } else if (key === "insights_subscriptions") {
      _pushSubscriptions(value).catch(function () { _queueRetry(key, value); });
    } else if (key === "aleph_settings") {
      _pushSettings(value).catch(function () { _queueRetry(key, value); });
    }
  }

  async function _pushUsageDay(dateKey: string, data: unknown) {
    const docRef = _db.collection("users").doc(_uid).collection("usage").doc(dateKey);
    const payload = Object.assign({}, data, {
      _lastModified: firebase.firestore.FieldValue.serverTimestamp(),
    });
    await docRef.set(payload, { merge: true });
    _updateLastSyncTime();
  }

  async function _pushSubscriptions(data: unknown) {
    const docRef = _db.collection("users").doc(_uid).collection("meta").doc("subscriptions");
    await docRef.set(data, { merge: true });
    _updateLastSyncTime();
  }

  async function _pushSettings(data: unknown) {
    const docRef = _db.collection("users").doc(_uid).collection("meta").doc("settings");
    await docRef.set(data, { merge: true });
    _updateLastSyncTime();
  }

  // ── Pull & Merge ──────────────────────────────────────────

  async function fullMergeAndSync() {
    if (!_uid) return;

    const usageSnap = await _db.collection("users").doc(_uid).collection("usage").get();
    const subSnap = await _db.collection("users").doc(_uid).collection("meta").doc("subscriptions").get();

    // Firestore document data — raw JSON, boundary `any`.
    const remoteUsage: Record<string, any> = {};
    usageSnap.forEach(function (doc: any) {
      remoteUsage["usage_" + doc.id] = doc.data();
    });

    const allLocal = await chrome.storage.local.get(null);
    const localUsageKeys = Object.keys(allLocal).filter(function (k) { return k.startsWith("usage_"); });
    const allKeys = new Set(localUsageKeys.concat(Object.keys(remoteUsage)));

    const batch = _db.batch();
    let batchCount = 0;
    const localWrites: Record<string, any> = {};

    allKeys.forEach(function (key) {
      const dateKey = key.replace("usage_", "");
      const local = allLocal[key] || {};
      const remote = remoteUsage[key] || {};
      if (remote._lastModified) delete remote._lastModified;
      const merged = _mergeUsageDay(local, remote);

      localWrites[key] = merged;

      const docRef = _db.collection("users").doc(_uid).collection("usage").doc(dateKey);
      const payload = Object.assign({}, merged, {
        _lastModified: firebase.firestore.FieldValue.serverTimestamp(),
      });
      batch.set(docRef, payload, { merge: true });
      batchCount++;
    });

    if (batchCount > 0) {
      await chrome.storage.local.set(localWrites);
      if (batchCount <= 500) {
        await batch.commit();
      }
    }

    if (subSnap.exists) {
      const remoteSubs = subSnap.data();
      const localSubs = allLocal["insights_subscriptions"] || {};
      const mergedSubs = Object.assign({}, remoteSubs, localSubs);
      await chrome.storage.local.set({ insights_subscriptions: mergedSubs });
      await _pushSubscriptions(mergedSubs);
    }

    const settingsSnap = await _db.collection("users").doc(_uid).collection("meta").doc("settings").get();
    const localSettings = await chrome.storage.sync.get(null);
    if (settingsSnap.exists) {
      const remoteSettings = settingsSnap.data();
      const mergedSettings = Object.assign({}, localSettings, remoteSettings);
      await chrome.storage.sync.set(mergedSettings);
      await _pushSettings(mergedSettings);
    } else if (Object.keys(localSettings).length > 0) {
      await _pushSettings(localSettings);
    }

    _updateLastSyncTime();
  }

  // ── Retry Queue ───────────────────────────────────────────

  async function _queueRetry(key: string, value: unknown) {
    try {
      const result = await chrome.storage.local.get({ [QUEUE_KEY]: [] });
      let queue: RetryQueueEntry[] = result[QUEUE_KEY];
      queue.push({ key: key, value: value, ts: Date.now() });
      if (queue.length > 50) queue = queue.slice(-50);
      await chrome.storage.local.set({ [QUEUE_KEY]: queue });
    } catch (e) {}
  }

  async function processRetryQueue() {
    if (!_uid) return;
    try {
      const result = await chrome.storage.local.get({ [QUEUE_KEY]: [] });
      const queue: RetryQueueEntry[] = result[QUEUE_KEY];
      if (queue.length === 0) return;

      const remaining: RetryQueueEntry[] = [];
      for (const entry of queue) {
        try {
          if (entry.key.startsWith("usage_")) {
            await _pushUsageDay(entry.key.replace("usage_", ""), entry.value);
          } else if (entry.key === "insights_subscriptions") {
            await _pushSubscriptions(entry.value);
          } else if (entry.key === "aleph_settings") {
            await _pushSettings(entry.value);
          }
        } catch (e) {
          remaining.push(entry);
        }
      }
      await chrome.storage.local.set({ [QUEUE_KEY]: remaining });
    } catch (e) {}
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

  return {
    init: init,
    signIn: signIn,
    signOut: signOut,
    restoreAuth: restoreAuth,
    getAuthState: getAuthState,
    maybePush: maybePush,
    fullMergeAndSync: fullMergeAndSync,
    processRetryQueue: processRetryQueue,
  };
})();
