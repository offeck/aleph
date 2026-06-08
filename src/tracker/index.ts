import { PLATFORM } from "./platform";
import { startTimeTracking } from "./time";
import { markExistingMessages, setGraceUntil, startEditorCapture, startMessageObserver, startNavRemark } from "./messages";
import { startResponseTiming } from "./timing";
import { sendSubscriptionDetection } from "./plans";
import { TRACKER_ADAPTERS, type TrackerPlatformAdapter } from "./platformAdapters";

function detectSubscription(adapter: TrackerPlatformAdapter) {
  if (!adapter.plan) return;
  // Detection scrapes third-party DOM on a 60s interval; one wrong-shape
  // change must not throw repeatedly. Blanket try matches the pre-refactor
  // detectSubscription() (detect + send under one swallow).
  try {
    sendSubscriptionDetection(adapter.platform, adapter.plan.detect());
  } catch (e) {}
}

function pollUsage(adapter: TrackerPlatformAdapter) {
  adapter.usage?.poll();
}

function pollModelCapabilities(adapter: TrackerPlatformAdapter) {
  adapter.modelCaps?.poll?.();
}

// ── Boot ─────────────────────────────────────────────────
// Modules only define; everything observable starts here, gated on a
// supported platform (manifest matches keep this always-true in practice).
const adapter = PLATFORM ? TRACKER_ADAPTERS[PLATFORM] : null;

if (adapter) {
  startTimeTracking(adapter.platform);
  if (adapter.timing) startResponseTiming(adapter.timing);
  startEditorCapture(adapter);
  startNavRemark(adapter);

  adapter.plan?.bootstrap?.();

  setTimeout(() => {
    detectSubscription(adapter);
    markExistingMessages(adapter);
    setGraceUntil(Date.now() + 5000);
    startMessageObserver(adapter);
    setTimeout(() => markExistingMessages(adapter), 5000);
    pollModelCapabilities(adapter);
    pollUsage(adapter);
  }, 3000);

  if (adapter.plan) setInterval(() => detectSubscription(adapter), 60000);
  if (adapter.usage) setInterval(() => pollUsage(adapter), 60000);
}
