import { PLATFORM_CONTRACT, type ContractAnchor } from "../shared/contract";
import type { Platform } from "../shared/platform";

// One warning per platform/key so a sustained miss does not spam the console.
const warned = new Set<string>();

function anchorPresent(anchor: ContractAnchor): boolean {
  return anchor.selectors.some((s) => document.querySelector(s) != null);
}

// True when this platform's last detected/stored plan is a paid tier — the
// disambiguator that lets a "paidOnly" anchor (e.g. Gemini's tier badge) be
// required without false-failing free users. The stored plan persists across a
// selector break because detection returns null (not "free") when it can't read.
async function storedPlanIsPaid(platform: Platform): Promise<boolean> {
  try {
    const result = await chrome.storage.local.get("insights_subscriptions");
    const subs = (result.insights_subscriptions as Record<string, { plan?: string }> | undefined) || {};
    const plan = subs[platform]?.plan;
    return typeof plan === "string" && plan !== "" && plan !== "free";
  } catch (e) {
    return false;
  }
}

// Verifies the platform's required detection anchors still resolve and publishes
// the verdict on <html> for the `platform-contract` regression check, plus a
// one-off console warning naming what broke. Runs on the tracker's contract
// cadence (a few early passes + a steady interval, see index.ts).
export async function checkPlatformContract(platform: Platform) {
  const anchors = PLATFORM_CONTRACT[platform];
  if (!anchors) return;

  const presence = anchors.map((a) => ({ anchor: a, present: anchorPresent(a) }));
  // No anchor of any role resolves → not on a signed-in app page (settings,
  // logged out, not yet loaded). Don't judge; leave any prior verdict untouched.
  if (!presence.some((p) => p.present)) return;

  const missing = presence.filter((p) => !p.present && p.anchor.role === "required").map((p) => p.anchor.key);
  // A "paidOnly" anchor only counts as missing when the account is actually paid.
  const paidMissing = presence.filter((p) => !p.present && p.anchor.role === "paidOnly");
  if (paidMissing.length && (await storedPlanIsPaid(platform))) {
    missing.push(...paidMissing.map((p) => p.anchor.key));
  }

  const el = document.documentElement;
  if (missing.length) {
    el.setAttribute("data-aleph-contract-missing", missing.join(","));
    el.removeAttribute("data-aleph-contract");
    for (const key of missing) {
      const id = platform + "/" + key;
      if (warned.has(id)) continue;
      warned.add(id);
      console.warn("[Aleph] contract drift on " + platform + ": '" + key + "' anchor no longer matches — detection may be broken");
    }
  } else {
    el.setAttribute("data-aleph-contract", "ok");
    el.removeAttribute("data-aleph-contract-missing");
    warned.clear(); // anchors recovered → allow a future regression to warn again
  }
}
