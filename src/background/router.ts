import { alephSync } from "./sync";
import { todayKey, usageKeyForDate } from "../shared/dates";
import type {
  ContentToBackgroundMessage,
  ExternalMessage,
  InsightsSummary,
  PageToBackgroundMessage,
  StoredRemark,
} from "../shared/messages";
import {
  applyMessageUsage,
  applySendAnalytics,
  ensurePlatformDay,
  numberOrZero,
  readCombinedUsageDays,
  readLocal,
  updateUsageDay,
  writeLocal,
} from "./usage";
import { generateRemark } from "./remarks";
import { cleanupOldUsage } from "./cleanup";
import { clearAntigravityUsage, LIMITS_REFRESH_ALARM, LIMITS_REFRESH_PERIOD_MINUTES, refreshProviderUsage } from "./providerUsage";
import {
  ANTIGRAVITY_REDIRECT_URI,
  captureAntigravityCode,
  disconnectAntigravity,
  getAntigravityAuthStatus,
  setAntigravitySecret,
  startAntigravityConnect,
} from "./antigravityAuth";
import { reconcilePrimerAlarms, handlePrimerAlarm, runPrimerNow, getPrimerStatus } from "./primer";
import { PRIMER_ALARM_PREFIX } from "./primerSchedule";

// Pull the OAuth authorization code out of the loopback callback URL. After
// consent, Google redirects the tab to http://localhost:51121/oauth-callback?code=…;
// nothing listens there so the page fails to load, but the tab URL still carries
// the code and is readable via the http://localhost/* host permission. The
// accounts.google.com consent steps are opaque to us, which is fine.
function antigravityCodeFromUrl(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null;
  try {
    const u = new URL(rawUrl);
    if (u.origin + u.pathname !== ANTIGRAVITY_REDIRECT_URI) return null;
    return u.searchParams.get("code");
  } catch (e) {
    return null;
  }
}

// One-click connect: open the consent tab, then watch it for the authcode
// redirect and capture the code from the URL — no manual paste. On success the
// token write lands in insights_antigravity_auth (settings re-renders via
// storage.onChanged) and usage refreshes so the popup meters populate.
async function startAntigravityTabConnect(): Promise<{ started: boolean; error?: string }> {
  let url: string;
  try {
    ({ url } = await startAntigravityConnect());
  } catch (e) {
    return { started: false, error: e instanceof Error ? e.message : String(e) };
  }
  const tab = await chrome.tabs.create({ url });
  const tabId = tab.id;
  if (tabId == null) return { started: false, error: "Could not open the consent tab." };

  const onUpdated = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo, tabInfo: chrome.tabs.Tab) => {
    if (updatedTabId !== tabId) return;
    const code = antigravityCodeFromUrl(changeInfo.url || tabInfo.url || undefined);
    if (!code) return;
    chrome.tabs.onUpdated.removeListener(onUpdated);
    chrome.tabs.onRemoved.removeListener(onRemoved);
    (async () => {
      const result = await captureAntigravityCode(code);
      try { await chrome.tabs.remove(tabId); } catch (e) {}
      // force=true: the popup's own opening refresh just wrote a fresh (Antigravity-less)
      // Gemini snapshot, which would otherwise throttle this one and hide the new meters.
      if (result.success) refreshProviderUsage("popup", true).catch(() => {});
    })();
  };
  // Drop the watcher if the user closes the consent tab without finishing.
  const onRemoved = (removedTabId: number) => {
    if (removedTabId !== tabId) return;
    chrome.tabs.onUpdated.removeListener(onUpdated);
    chrome.tabs.onRemoved.removeListener(onRemoved);
  };
  chrome.tabs.onUpdated.addListener(onUpdated);
  chrome.tabs.onRemoved.addListener(onRemoved);
  return { started: true };
}

// MV3 requires every chrome.* listener to be registered in the service
// worker's first synchronous turn — index.ts calls this from its module body.
export function registerBackgroundListeners() {
  // Idempotent (same name replaces). Created from install/startup only — NOT on
  // every worker boot, which would perpetually reset the period and starve it.
  const ensureLimitsAlarm = () => chrome.alarms.create(LIMITS_REFRESH_ALARM, { periodInMinutes: LIMITS_REFRESH_PERIOD_MINUTES });
  const bootSync = () => alephSync.restoreAuth().then(() => alephSync.ensureMigrated()).then(() => alephSync.flushDirty()).catch(() => {});
  chrome.runtime.onInstalled?.addListener(() => {
    cleanupOldUsage();
    ensureLimitsAlarm();
    bootSync();
    void reconcilePrimerAlarms();
  });
  chrome.runtime.onStartup?.addListener(() => {
    cleanupOldUsage();
    ensureLimitsAlarm();
    bootSync();
    void reconcilePrimerAlarms();
  });

  // Periodic limits refresh — works with no tab/popup open. refreshProviderUsage
  // re-derives auth (cookies/token) and refreshes limits together, keeping both
  // fresh while the CLIs (Claude Code, Codex) drain the shared account limits.
  // The listener must register in the worker's first synchronous turn (MV3).
  // The same tick flushes deferred cloud pushes (an MV3 worker death loses the
  // trailing throttle timer) and refreshes the remote usage cache.
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name.startsWith(PRIMER_ALARM_PREFIX)) { void handlePrimerAlarm(alarm.name); return; }
    if (alarm.name === LIMITS_REFRESH_ALARM) {
      refreshProviderUsage("alarm").catch(() => {});
      alephSync.flushDirty().then(() => alephSync.lightweightPull()).catch(() => {});
    }
  });

  // ── Settings sync to Firestore ───────────────────────────
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    try { alephSync.onSettingsChanged(changes); } catch (e) {}
    if (Object.keys(changes).some((k) => k.startsWith("primer"))) void reconcilePrimerAlarms();
  });

  // ── Message handlers ─────────────────────────────────────
  chrome.runtime.onMessageExternal.addListener((msg: ExternalMessage) => {
    if (msg.type === "aleph-reload") chrome.runtime.reload();
  });

  chrome.runtime.onMessage.addListener((msg: ContentToBackgroundMessage | PageToBackgroundMessage, sender, sendResponse) => {
    // Sync handlers — from popup/settings (not content scripts)
    if (msg.type === "aleph-sync-signin") {
      alephSync.signIn().then(sendResponse);
      return true;
    }
    if (msg.type === "aleph-sync-signout") {
      alephSync.signOut().then(sendResponse);
      return true;
    }
    if (msg.type === "aleph-sync-status") {
      alephSync.getAuthState().then(sendResponse);
      return true;
    }
    if (msg.type === "aleph-sync-now") {
      alephSync.fullMergeAndSync().then(() => sendResponse({ success: true })).catch((e) => sendResponse({ success: false, error: e.message }));
      return true;
    }

    // Antigravity (experimental, opt-in) — secret entry + login from the popup,
    // logout from settings; borrowed-client OAuth, see antigravityAuth.ts.
    if (msg.type === "aleph-antigravity-connect") {
      startAntigravityTabConnect().then(sendResponse);
      return true;
    }
    if (msg.type === "aleph-antigravity-status") {
      getAntigravityAuthStatus().then(sendResponse);
      return true;
    }
    if (msg.type === "aleph-antigravity-set-secret") {
      const secret = msg.secret;
      setAntigravitySecret(secret)
        // Clearing the secret turns the feature inert — drop stale meters now
        // rather than waiting for the next refresh to notice it's disconnected.
        .then(() => (secret.trim() ? Promise.resolve() : clearAntigravityUsage()))
        .then(() => sendResponse({ success: true }))
        .catch(() => sendResponse({ success: false }));
      return true;
    }
    if (msg.type === "aleph-antigravity-disconnect") {
      disconnectAntigravity()
        .then(() => clearAntigravityUsage())
        .then(() => sendResponse({ success: true }))
        .catch(() => sendResponse({ success: false }));
      return true;
    }

    // Insights summary — allowed from any extension context (popup, dashboard)
    if (msg.type === "insights-get-summary") {
      (async () => {
        // Refresh the remote-device cache in the background (5-min throttled);
        // this response serves the current cache, the next open is fresher.
        alephSync.lightweightPull().catch(() => {});

        const subs = await readLocal<Record<string, any>>("insights_subscriptions", {});
        const key = todayKey();
        const remark = await readLocal<StoredRemark | null>("insights_last_remark", null);

        const now = new Date();
        const weekKeys: string[] = [];
        const prevWeekKeys: string[] = [];
        for (let i = 0; i < 14; i++) {
          const d = new Date(now);
          d.setDate(d.getDate() - i);
          (i < 7 ? weekKeys : prevWeekKeys).push(usageKeyForDate(d));
        }

        // Local docs ADD the synced remote cache — multi-device totals.
        const combined = await readCombinedUsageDays([...weekKeys, ...prevWeekKeys]);
        const today = combined[key] || {};
        const weekData: Record<string, any> = {};
        for (const wk of weekKeys) weekData[wk] = combined[wk];
        const prevWeekData: Record<string, any> = {};
        for (const wk of prevWeekKeys) prevWeekData[wk] = combined[wk];

        const platformUsage: Record<string, any> = {};
        for (const p of ["claude", "chatgpt", "gemini"]) {
          platformUsage[p] = await readLocal<Record<string, any> | null>("insights_platform_usage_" + p, null);
        }

        const modelCaps: Record<string, any> = {};
        for (const p of ["claude", "chatgpt", "gemini"]) {
          modelCaps[p] = await readLocal<Record<string, any> | null>("insights_model_caps_" + p, null);
        }

        const summary: InsightsSummary = { subs, today, remark, weekData, prevWeekData, platformUsage, modelCaps };
        sendResponse(summary);
      })();
      return true;
    }

    if (msg.type === "insights-refresh-usage") {
      refreshProviderUsage("popup").then(sendResponse);
      return true;
    }

    if (msg.type === "aleph-primer-run-now") {
      runPrimerNow(msg.target).then(sendResponse);
      return true;
    }
    if (msg.type === "aleph-primer-status") {
      getPrimerStatus().then(sendResponse);
      return true;
    }

    if (!sender.tab) return;
    const tabId = sender.tab.id;

    // Badge (existing)
    if (msg.type === "badge") {
      const count = msg.count || 0;
      chrome.action.setBadgeText({ text: count > 0 ? String(count) : "", tabId });
      chrome.action.setBadgeBackgroundColor({ color: "#7c83ff", tabId });
    }

    if (msg.type === "disabled") {
      chrome.action.setBadgeText({ text: "OFF", tabId });
      chrome.action.setBadgeBackgroundColor({ color: "#666", tabId });
    }

    // Insights: time tracking
    if (msg.type === "insights-time") {
      (async () => {
        const p = msg.platform;
        await updateUsageDay(async (usage) => {
          const day = ensurePlatformDay(usage, p);
          const seconds = numberOrZero(msg.seconds);
          day.totalSeconds += seconds;
          const h = String(msg.hour);
          day.hours[h] = (day.hours[h] || 0) + seconds;
        });

        const remark = await readLocal<StoredRemark | null>("insights_last_remark", null);
        if (!remark || Date.now() - remark.generatedAt > 1800000) {
          await generateRemark(p);
        }
      })();
    }

    // Insights: message counts and local token estimates
    if (msg.type === "insights-message") {
      (async () => {
        const role = msg.role;
        if (role !== "user" && role !== "assistant") return;
        await updateUsageDay((usage) => {
          applyMessageUsage(ensurePlatformDay(usage, msg.platform), msg, role);
        });
      })();
    }

    if (msg.type === "insights-send-analytics") {
      (async () => {
        const p = msg.platform;
        await updateUsageDay(async (usage) => {
          applySendAnalytics(ensurePlatformDay(usage, p), msg);
        });
      })();
    }

    if (msg.type === "insights-response-timing") {
      (async () => {
        const p = msg.platform;
        await updateUsageDay(async (usage) => {
          const day = ensurePlatformDay(usage, p);
          if (!day.timing) day.timing = { count: 0, totalTTFT: 0, totalThinking: 0, totalSendToThinking: 0, approximate: true };
          day.timing.count++;
          day.timing.totalTTFT += numberOrZero(msg.totalTTFT);
          day.timing.totalThinking += numberOrZero(msg.thinkingToFirstToken);
          day.timing.totalSendToThinking += numberOrZero(msg.sendToThinking);
          day.timing.approximate = true;
        });
      })();
    }

    // Insights: subscription detection
    if (msg.type === "insights-subscription") {
      (async () => {
        // Stored subscriptions are raw JSON — boundary `any`.
        const subs = await readLocal<Record<string, any>>("insights_subscriptions", {});
        if (subs[msg.platform]?.manualOverride) return;
        subs[msg.platform] = {
          plan: msg.plan,
          price: msg.price,
          label: msg.label,
          model: msg.model,
          detectedAt: Date.now(),
          manualOverride: false,
        };
        await writeLocal("insights_subscriptions", subs);
      })();
    }

    // Insights: model capabilities
    if (msg.type === "insights-model-caps") {
      (async () => {
        await writeLocal("insights_model_caps_" + msg.platform, {
          ...msg.caps,
          fetchedAt: Date.now(),
        });
      })();
    }

    // insights-get-summary handled above the sender.tab guard
  });

  // Toggle command (existing)
  chrome.commands.onCommand.addListener((command, tab) => {
    if (command === "toggle-aleph" && tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: "toggle" });
    }
  });
}
