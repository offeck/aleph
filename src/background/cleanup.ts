import { usageKeyForDate } from "../shared/dates";

// ── Cleanup ──────────────────────────────────────────────
export async function cleanupOldUsage() {
  const all = await chrome.storage.local.get(null);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffStr = usageKeyForDate(cutoff);
  const toRemove = Object.keys(all).filter((k) => (
    k === "insights_chatgpt_model_ts" || (k.startsWith("usage_") && k < cutoffStr)
  ));
  if (toRemove.length > 0) await chrome.storage.local.remove(toRemove);
}
