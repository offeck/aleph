export const alephSync = (function () {
  "use strict";

  var _db = null;
  var _auth = null;
  var _uid = null;
  var _debounce = {};
  var DEBOUNCE_MS = 60000;
  var AUTH_KEY = "aleph_sync_auth";
  var QUEUE_KEY = "aleph_sync_queue";

  function init(fb) {
    _auth = fb.auth();
    _db = fb.firestore();
  }

  // ── Auth ──────────────────────────────────────────────────

  async function signIn() {
    try {
      var token = await new Promise(function (resolve, reject) {
        chrome.identity.getAuthToken({ interactive: true }, function (t) {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(t);
        });
      });
      var credential = firebase.auth.GoogleAuthProvider.credential(null, token);
      var result = await _auth.signInWithCredential(credential);
      var user = result.user;
      _uid = user.uid;
      var state = { signedIn: true, uid: user.uid, email: user.email, lastSyncAt: null };
      await chrome.storage.local.set({ [AUTH_KEY]: state });
      fullMergeAndSync().catch(function () {});
      return { success: true, email: user.email };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async function signOut() {
    try {
      var state = await _getStoredAuth();
      await _auth.signOut();
      if (state && state.token) {
        await new Promise(function (resolve) {
          chrome.identity.removeCachedAuthToken({ token: state.token }, resolve);
        });
      }
      _uid = null;
      await chrome.storage.local.remove([AUTH_KEY, QUEUE_KEY]);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async function restoreAuth() {
    try {
      var state = await _getStoredAuth();
      if (!state || !state.signedIn) return;
      var token = await new Promise(function (resolve, reject) {
        chrome.identity.getAuthToken({ interactive: false }, function (t) {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(t);
        });
      });
      var credential = firebase.auth.GoogleAuthProvider.credential(null, token);
      var result = await _auth.signInWithCredential(credential);
      _uid = result.user.uid;
    } catch (e) {
      _uid = null;
      await chrome.storage.local.remove(AUTH_KEY);
    }
  }

  async function getAuthState() {
    var state = await _getStoredAuth();
    return state || { signedIn: false, uid: null, email: null, lastSyncAt: null };
  }

  async function _getStoredAuth() {
    var result = await chrome.storage.local.get({ [AUTH_KEY]: null });
    return result[AUTH_KEY];
  }

  // ── Push ──────────────────────────────────────────────────

  function maybePush(key, value) {
    if (!_uid) return;
    var now = Date.now();
    if (_debounce[key] && (now - _debounce[key]) < DEBOUNCE_MS) return;
    _debounce[key] = now;

    if (key.startsWith("usage_")) {
      var dateKey = key.replace("usage_", "");
      _pushUsageDay(dateKey, value).catch(function () { _queueRetry(key, value); });
    } else if (key === "insights_subscriptions") {
      _pushSubscriptions(value).catch(function () { _queueRetry(key, value); });
    } else if (key === "aleph_settings") {
      _pushSettings(value).catch(function () { _queueRetry(key, value); });
    }
  }

  async function _pushUsageDay(dateKey, data) {
    var docRef = _db.collection("users").doc(_uid).collection("usage").doc(dateKey);
    var payload = Object.assign({}, data, {
      _lastModified: firebase.firestore.FieldValue.serverTimestamp(),
    });
    await docRef.set(payload, { merge: true });
    _updateLastSyncTime();
  }

  async function _pushSubscriptions(data) {
    var docRef = _db.collection("users").doc(_uid).collection("meta").doc("subscriptions");
    await docRef.set(data, { merge: true });
    _updateLastSyncTime();
  }

  async function _pushSettings(data) {
    var docRef = _db.collection("users").doc(_uid).collection("meta").doc("settings");
    await docRef.set(data, { merge: true });
    _updateLastSyncTime();
  }

  // ── Pull & Merge ──────────────────────────────────────────

  async function fullMergeAndSync() {
    if (!_uid) return;

    var usageSnap = await _db.collection("users").doc(_uid).collection("usage").get();
    var subSnap = await _db.collection("users").doc(_uid).collection("meta").doc("subscriptions").get();

    var remoteUsage = {};
    usageSnap.forEach(function (doc) {
      remoteUsage["usage_" + doc.id] = doc.data();
    });

    var allLocal = await chrome.storage.local.get(null);
    var localUsageKeys = Object.keys(allLocal).filter(function (k) { return k.startsWith("usage_"); });
    var allKeys = new Set(localUsageKeys.concat(Object.keys(remoteUsage)));

    var batch = _db.batch();
    var batchCount = 0;
    var localWrites = {};

    allKeys.forEach(function (key) {
      var dateKey = key.replace("usage_", "");
      var local = allLocal[key] || {};
      var remote = remoteUsage[key] || {};
      if (remote._lastModified) delete remote._lastModified;
      var merged = _mergeUsageDay(local, remote);

      localWrites[key] = merged;

      var docRef = _db.collection("users").doc(_uid).collection("usage").doc(dateKey);
      var payload = Object.assign({}, merged, {
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
      var remoteSubs = subSnap.data();
      var localSubs = allLocal["insights_subscriptions"] || {};
      var mergedSubs = Object.assign({}, remoteSubs, localSubs);
      await chrome.storage.local.set({ insights_subscriptions: mergedSubs });
      await _pushSubscriptions(mergedSubs);
    }

    var settingsSnap = await _db.collection("users").doc(_uid).collection("meta").doc("settings").get();
    var localSettings = await new Promise(function (r) { chrome.storage.sync.get(null, r); });
    if (settingsSnap.exists) {
      var remoteSettings = settingsSnap.data();
      var mergedSettings = Object.assign({}, localSettings, remoteSettings);
      await new Promise(function (r) { chrome.storage.sync.set(mergedSettings, r); });
      await _pushSettings(mergedSettings);
    } else if (Object.keys(localSettings).length > 0) {
      await _pushSettings(localSettings);
    }

    _updateLastSyncTime();
  }

  function _mergeUsageDay(local, remote) {
    var platforms = ["claude", "chatgpt", "gemini"];
    var merged = Object.assign({}, remote, local);
    delete merged._lastModified;
    for (var i = 0; i < platforms.length; i++) {
      var p = platforms[i];
      var l = local[p] || {};
      var r = remote[p] || {};
      var day = Object.assign({}, r, l);
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

  function _mergeCounterFields(target, local, remote, fields) {
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      target[f] = Math.max(local[f] || 0, remote[f] || 0);
    }
  }

  function _mergeNestedCounters(local, remote, fields) {
    var merged = Object.assign({}, remote, local);
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      var value = Math.max(local[f] || 0, remote[f] || 0);
      if (value > 0) merged[f] = value;
      else delete merged[f];
    }
    return merged;
  }

  function _mergeSends(localS, remoteS) {
    return {
      total: Math.max(localS.total || 0, remoteS.total || 0),
      rtl: Math.max(localS.rtl || localS.hebrew || 0, remoteS.rtl || remoteS.hebrew || 0),
      totalWords: Math.max(localS.totalWords || 0, remoteS.totalWords || 0),
      totalChars: Math.max(localS.totalChars || 0, remoteS.totalChars || 0),
    };
  }

  function _mergeHours(localH, remoteH) {
    var merged = Object.assign({}, localH);
    for (var h in remoteH) {
      merged[h] = Math.max(merged[h] || 0, remoteH[h]);
    }
    return merged;
  }

  // ── Retry Queue ───────────────────────────────────────────

  async function _queueRetry(key, value) {
    try {
      var result = await chrome.storage.local.get({ [QUEUE_KEY]: [] });
      var queue = result[QUEUE_KEY];
      queue.push({ key: key, value: value, ts: Date.now() });
      if (queue.length > 50) queue = queue.slice(-50);
      await chrome.storage.local.set({ [QUEUE_KEY]: queue });
    } catch (e) {}
  }

  async function processRetryQueue() {
    if (!_uid) return;
    try {
      var result = await chrome.storage.local.get({ [QUEUE_KEY]: [] });
      var queue = result[QUEUE_KEY];
      if (queue.length === 0) return;

      var remaining = [];
      for (var i = 0; i < queue.length; i++) {
        try {
          if (queue[i].key.startsWith("usage_")) {
            await _pushUsageDay(queue[i].key.replace("usage_", ""), queue[i].value);
          } else if (queue[i].key === "insights_subscriptions") {
            await _pushSubscriptions(queue[i].value);
          } else if (queue[i].key === "aleph_settings") {
            await _pushSettings(queue[i].value);
          }
        } catch (e) {
          remaining.push(queue[i]);
        }
      }
      await chrome.storage.local.set({ [QUEUE_KEY]: remaining });
    } catch (e) {}
  }

  // ── Helpers ───────────────────────────────────────────────

  async function _updateLastSyncTime() {
    try {
      var result = await chrome.storage.local.get({ [AUTH_KEY]: null });
      var state = result[AUTH_KEY];
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
