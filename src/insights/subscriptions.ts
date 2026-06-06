import { usageKeyForDate } from "../shared/dates";
import { formatTokens } from "../shared/format";
import { PLATFORMS, platformSettingSuffix, type Platform } from "../shared/platform";
import { PRICING } from "../shared/pricing";

// Stored subscriptions and usage-day docs are raw storage JSON — boundary
// `any` records, read defensively.

export function normalizeStoredPlan(platform: Platform, sub: any): string {
  const plan = (sub && sub.plan) || "free";
  if (platform === "chatgpt" && plan === "pro") {
    return sub && sub.price === 200 ? "pro20x" : "pro5x";
  }
  return plan;
}

// ── Subscriptions ───────────────────────────────────────
export function loadSubscriptions(subs: Record<string, any>, today: Record<string, any>) {
  let totalSpend = 0;
  for (const p of PLATFORMS) {
    const sub = subs[p] || {};
    const card = document.getElementById("sub" + platformSettingSuffix(p));
    if (!card) continue;

    const plan = normalizeStoredPlan(p, sub);
    const pricing = PRICING[p][plan] || PRICING[p].free;
    const price = sub.price != null ? sub.price : pricing.price;
    totalSpend += price;

    card.querySelector(".plan-badge")!.textContent = sub.plan === plan && sub.label ? sub.label : pricing.label;
    card.querySelector(".sub-price")!.textContent = price > 0 ? "$" + price + "/mo" : "Free";
    card.querySelector(".model-name")!.textContent = sub.model || "Default model";

    const dayData = today[p] || {};
    card.querySelector(".tokens-in")!.textContent = formatTokens(dayData.tokensIn) + " in";
    card.querySelector(".tokens-out")!.textContent = formatTokens(dayData.tokensOut) + " out";
  }
  document.getElementById("totalSpend")!.textContent = "$" + totalSpend.toFixed(2) + " / month";
}

// ── Manual Overrides ────────────────────────────────────
export function bindOverrides(subs: Record<string, any>) {
  for (const p of PLATFORMS) {
    const select = document.getElementById("override" + platformSettingSuffix(p)) as HTMLSelectElement | null;
    if (!select) continue;

    // Set current value
    const sub = subs[p] || {};
    const storedPlan = normalizeStoredPlan(p, sub);
    if (storedPlan && select.querySelector('option[value="' + storedPlan + '"]')) {
      select.value = storedPlan;
    }

    select.addEventListener("change", () => {
      const plan = select.value;
      const pricing = PRICING[p][plan] || PRICING[p].free;
      chrome.storage.local.get({ insights_subscriptions: {} }, (result) => {
        const allSubs = result.insights_subscriptions;
        allSubs[p] = {
          plan: plan,
          price: pricing.price,
          label: pricing.label,
          model: (allSubs[p] && allSubs[p].model) || "Default model",
          detectedAt: Date.now(),
          manualOverride: true,
        };
        chrome.storage.local.set({ insights_subscriptions: allSubs }, () => {
          // Refresh subscriptions display
          const todayKey = usageKeyForDate();
          chrome.storage.local.get({ [todayKey]: {}, insights_subscriptions: {} }, (r) => {
            loadSubscriptions(r.insights_subscriptions, r[todayKey]);
          });
        });
      });
    });
  }
}
