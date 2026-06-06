import type { InsightsSummary } from "../shared/messages";
import { PLATFORMS, platformSettingSuffix } from "../shared/platform";
import { loadHourlyChart, loadPredictions, loadRemark, loadTodayTable, loadWeekSummary } from "./charts";
import { bindOverrides, loadSubscriptions, normalizeStoredPlan } from "./subscriptions";

// ── Init ────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  chrome.runtime.sendMessage({ type: "insights-get-summary" }, (resp: InsightsSummary | undefined) => {
    if (!resp) return;
    const subs = resp.subs || {};
    const today = resp.today || {};
    const remark = resp.remark || null;
    const weekData = resp.weekData || {};

    loadSubscriptions(subs, today);
    loadHourlyChart(today);
    loadTodayTable(today);
    loadWeekSummary(weekData);
    loadPredictions(weekData);
    loadRemark(remark);
    bindOverrides(subs);
  });

  // Also read subscriptions directly for freshest override data
  chrome.storage.local.get({ insights_subscriptions: {} }, (result) => {
    const subs = result.insights_subscriptions;
    for (const p of PLATFORMS) {
      const sub = subs[p] || {};
      const select = document.getElementById("override" + platformSettingSuffix(p)) as HTMLSelectElement | null;
      const plan = normalizeStoredPlan(p, sub);
      if (select && plan && select.querySelector('option[value="' + plan + '"]')) {
        select.value = plan;
      }
    }
  });
});
