import { beforeEach, describe, expect, it, vi } from "vitest";
import { PLATFORM_CONTRACT } from "../../src/shared/contract";
import { checkPlatformContract } from "../../src/tracker/contract";
import { PLATFORMS } from "../../src/shared/platform";

// Guards the canary itself: the contract must never be silently emptied, every
// anchor must be role-tagged, and each platform needs a required anchor (to
// assert on) plus a witness (so a missing required anchor reads as drift, not an
// off-app page).
describe("PLATFORM_CONTRACT", () => {
  it("covers every platform with well-formed, role-tagged anchors", () => {
    for (const platform of PLATFORMS) {
      const anchors = PLATFORM_CONTRACT[platform];
      expect(anchors, platform).toBeDefined();
      expect(anchors.length, platform).toBeGreaterThan(0);
      for (const a of anchors) {
        expect(a.key, platform).toBeTruthy();
        expect(a.selectors.length, platform + "/" + a.key).toBeGreaterThan(0);
        expect(a.selectors.every((s) => typeof s === "string" && s.length > 0), platform + "/" + a.key).toBe(true);
        expect(["required", "witness", "paidOnly"], platform + "/" + a.key).toContain(a.role);
      }
      expect(anchors.some((a) => a.role === "required"), platform).toBe(true);
      expect(anchors.some((a) => a.role === "witness"), platform).toBe(true);
    }
  });
});

describe("checkPlatformContract", () => {
  let attrs: Record<string, string>;

  function setup(presentSelectors: string[], geminiPlan?: string) {
    attrs = {};
    vi.stubGlobal("document", {
      documentElement: {
        setAttribute: (k: string, v: string) => { attrs[k] = v; },
        removeAttribute: (k: string) => { delete attrs[k]; },
        getAttribute: (k: string) => (k in attrs ? attrs[k] : null),
      },
      querySelector: (s: string) => (presentSelectors.includes(s) ? {} : null),
    });
    vi.stubGlobal("chrome", {
      storage: {
        local: { get: async () => ({ insights_subscriptions: geminiPlan ? { gemini: { plan: geminiPlan } } : {} }) },
      },
    });
  }

  beforeEach(() => vi.unstubAllGlobals());

  it("publishes ok when all required anchors resolve", async () => {
    setup([".ql-editor", ".mavatar-user-info", ".mavatar-tier-label"], "ai_pro");
    await checkPlatformContract("gemini");
    expect(attrs["data-aleph-contract"]).toBe("ok");
    expect(attrs["data-aleph-contract-missing"]).toBeUndefined();
  });

  it("flags the tier badge when a PAID account loses it (the Gemini regression)", async () => {
    setup([".ql-editor", ".mavatar-user-info"], "ai_pro"); // witness + account present, tier badge gone
    await checkPlatformContract("gemini");
    expect(attrs["data-aleph-contract-missing"]).toBe("tierBadge");
    expect(attrs["data-aleph-contract"]).toBeUndefined();
  });

  it("does NOT flag the tier badge for a free account", async () => {
    setup([".ql-editor", ".mavatar-user-info"], "free"); // free user legitimately has no badge
    await checkPlatformContract("gemini");
    expect(attrs["data-aleph-contract"]).toBe("ok");
    expect(attrs["data-aleph-contract-missing"]).toBeUndefined();
  });

  it("flags a required anchor (account menu) regardless of plan, witness present", async () => {
    setup([".ql-editor"], "free"); // only composer (witness); account menu gone
    await checkPlatformContract("gemini");
    expect(attrs["data-aleph-contract-missing"]).toBe("accountMenu");
  });

  it("skips (no verdict) when no anchor resolves — not on the instrumented app", async () => {
    setup([], "ai_pro"); // settings / logged out / not loaded
    await checkPlatformContract("gemini");
    expect(attrs["data-aleph-contract"]).toBeUndefined();
    expect(attrs["data-aleph-contract-missing"]).toBeUndefined();
  });
});
