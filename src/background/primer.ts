import { readLocal, writeLocal, enqueueUsageWork } from "./usage";
import type { PrimerTarget } from "./primerSchedule";

export const PRIMER_STATUS_KEY = "primer_status";

export interface PrimerRunResult {
  at: number;
  ok: boolean;
  reason?: string;
  windowResetAt?: number;
  usedPercent?: number;
}

// A failed primer sets a global toolbar "!" (no tabId). The per-tab feature-count
// badge still overrides on AI-platform tabs; on every other tab the "!" is visible.
export function raiseFailureBadge(): void {
  try {
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#e5484d" });
  } catch (e) { /* action API may be absent in some contexts/tests */ }
}

export function clearFailureBadge(): void {
  try { chrome.action.setBadgeText({ text: "" }); } catch (e) { /* noop */ }
}

export async function recordPrimerResult(target: PrimerTarget, r: PrimerRunResult): Promise<void> {
  await enqueueUsageWork(async () => {
    const all = await readLocal<Record<string, PrimerRunResult>>(PRIMER_STATUS_KEY, {});
    all[target] = r;
    await writeLocal(PRIMER_STATUS_KEY, all);
  });
  if (!r.ok) raiseFailureBadge();
}

/** Reads the status map and clears the failure badge (the user has now seen it). */
export async function getPrimerStatus(): Promise<Record<string, PrimerRunResult>> {
  clearFailureBadge();
  return readLocal<Record<string, PrimerRunResult>>(PRIMER_STATUS_KEY, {});
}
