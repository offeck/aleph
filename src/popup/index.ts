import { loadInsights } from "./insightsView";
import { bindEvents, detectActivePlatform, loadSyncIndicator, loadUI } from "./ui";

document.addEventListener("DOMContentLoaded", () => {
  loadUI();
  bindEvents();
  loadInsights();
  chrome.runtime.sendMessage({ type: "insights-refresh-usage" }, () => {
    if (chrome.runtime.lastError) return;
    loadInsights();
  });
  detectActivePlatform();
  loadSyncIndicator();

  // Redraw as each platform's refreshed usage snapshot or detected plan lands
  // (background or alarm) — a refresh can update only the subscription (e.g. a
  // plan-only retry, or a failed usage fetch), so watch both. Debounced so
  // several writes coalesce into one redraw.
  let redrawTimer: ReturnType<typeof setTimeout> | null = null;
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== "local") return;
    const relevant = (k: string) => k.startsWith("insights_platform_usage_") || k === "insights_subscriptions";
    if (!Object.keys(changes).some(relevant)) return;
    if (redrawTimer) return;
    redrawTimer = setTimeout(() => { redrawTimer = null; loadInsights(); }, 50);
  });
});
