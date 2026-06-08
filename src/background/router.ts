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
  addNonNegative,
  ensurePlatformDay,
  normalizeSends,
  numberOrZero,
  readLocal,
  updateUsageDay,
  writeLocal,
} from "./usage";
import { generateRemark } from "./remarks";
import { cleanupOldUsage } from "./cleanup";
import { LIMITS_REFRESH_ALARM, LIMITS_REFRESH_PERIOD_MINUTES, refreshProviderUsage } from "./providerUsage";

// MV3 requires every chrome.* listener to be registered in the service
// worker's first synchronous turn — index.ts calls this from its module body.
export function registerBackgroundListeners() {
  // Idempotent (same name replaces). Created from install/startup only — NOT on
  // every worker boot, which would perpetually reset the period and starve it.
  const ensureLimitsAlarm = () => chrome.alarms.create(LIMITS_REFRESH_ALARM, { periodInMinutes: LIMITS_REFRESH_PERIOD_MINUTES });
  chrome.runtime.onInstalled?.addListener(() => {
    cleanupOldUsage();
    ensureLimitsAlarm();
    alephSync.restoreAuth().then(() => alephSync.processRetryQueue()).catch(() => {});
  });
  chrome.runtime.onStartup?.addListener(() => {
    cleanupOldUsage();
    ensureLimitsAlarm();
    alephSync.restoreAuth().then(() => alephSync.processRetryQueue()).catch(() => {});
  });

  // Periodic limits refresh — works with no tab/popup open. refreshProviderUsage
  // re-derives auth (cookies/token) and refreshes limits together, keeping both
  // fresh while the CLIs (Claude Code, Codex) drain the shared account limits.
  // The listener must register in the worker's first synchronous turn (MV3).
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === LIMITS_REFRESH_ALARM) refreshProviderUsage("alarm").catch(() => {});
  });

  // ── Settings sync to Firestore ───────────────────────────
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area !== "sync") return;
    chrome.storage.sync.get(null, (all) => {
      try { alephSync.maybePush("aleph_settings", all); } catch (e) {}
    });
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

    // Insights summary — allowed from any extension context (popup, dashboard)
    if (msg.type === "insights-get-summary") {
      (async () => {
        const subs = await readLocal<Record<string, any>>("insights_subscriptions", {});
        const key = todayKey();
        const today = await readLocal<Record<string, any>>(key, {});
        const remark = await readLocal<StoredRemark | null>("insights_last_remark", null);

        const weekData: Record<string, any> = {};
        const now = new Date();
        for (let i = 0; i < 7; i++) {
          const d = new Date(now);
          d.setDate(d.getDate() - i);
          const wk = usageKeyForDate(d);
          const data = await readLocal<Record<string, any> | null>(wk, null);
          weekData[wk] = data;
        }

        const prevWeekData: Record<string, any> = {};
        for (let i = 7; i < 14; i++) {
          const d = new Date(now);
          d.setDate(d.getDate() - i);
          const wk = usageKeyForDate(d);
          const data = await readLocal<Record<string, any> | null>(wk, null);
          prevWeekData[wk] = data;
        }

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
        const p = msg.platform;
        const role = msg.role;
        if (role !== "user" && role !== "assistant") return;
        await updateUsageDay(async (usage) => {
          const day = ensurePlatformDay(usage, p);
          const roleSuffix = role === "user" ? "In" : "Out";
          const totalDelta = msg.isUpdate ? numberOrZero(msg.tokenDelta) : numberOrZero(msg.estimatedTokens);
          const textDelta = msg.isUpdate ? numberOrZero(msg.textTokenDelta) : numberOrZero(msg.estimatedTextTokens ?? msg.textTokens);
          const imageDelta = msg.isUpdate ? numberOrZero(msg.imageTokenDelta) : numberOrZero(msg.estimatedImageTokens ?? msg.imageTokens);
          const fileDelta = msg.isUpdate ? numberOrZero(msg.fileTokenDelta) : numberOrZero(msg.estimatedFileTokens ?? msg.fileTokens);
          const imageCountDelta = msg.isUpdate ? numberOrZero(msg.imageCountDelta) : numberOrZero(msg.imageCount);
          const fileCountDelta = msg.isUpdate ? numberOrZero(msg.fileCountDelta) : numberOrZero(msg.fileCount);

          if (!msg.isUpdate) day.messageCount++;
          addNonNegative(day, "tokens" + roleSuffix, totalDelta);
          addNonNegative(day, "textTokens" + roleSuffix, textDelta);
          addNonNegative(day, "imageTokens" + roleSuffix, imageDelta);
          addNonNegative(day, "fileTokens" + roleSuffix, fileDelta);
          addNonNegative(day, "imageCount" + roleSuffix, imageCountDelta);
          addNonNegative(day, "fileCount" + roleSuffix, fileCountDelta);
          day.estimateSource = msg.estimateSource || "local";
        });
      })();
    }

    if (msg.type === "insights-send-analytics") {
      (async () => {
        const p = msg.platform;
        await updateUsageDay(async (usage) => {
          const day = ensurePlatformDay(usage, p);
          day.sends = normalizeSends(day.sends);
          day.sends.total++;
          if (msg.lang === "rtl" || msg.lang === "hebrew") day.sends.rtl++;
          day.sends.totalWords += numberOrZero(msg.words);
          day.sends.totalChars += numberOrZero(msg.length);
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
