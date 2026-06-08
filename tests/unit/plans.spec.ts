import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHATGPT_PLAN_RANK,
  detectGeminiSubscription,
  geminiPlanFromTierLabel,
  normalizeChatgptPlan,
  planFromPriceNumber,
  sendSubscriptionDetection,
} from "../../src/tracker/plans";
import { send } from "../../src/tracker/send";

vi.mock("../../src/tracker/send", () => ({ send: vi.fn() }));

describe("normalizeChatgptPlan", () => {
  // Fixture cases locked in during the PR #1 plan-price heuristic tightening:
  // junk numerics near amount/monthly keys must never classify a plan.
  const cases: Array<[string | null, string[], string | null]> = [
    ["plus", ["credit_amount:500"], "plus"],
    ["", ["amount:240"], null],
    [null, ["price:20000"], "pro20x"],
    [null, ["price:10000"], "pro5x"],
    ["pro", [], "pro5x"],
    ["prolite", [], "pro5x"],
    [null, ["planType:prolite"], "pro5x"],
    ["ChatGPT Plus", [], "plus"],
    ["the price is $200/mo", [], "pro20x"],
    ["free", [], "free"],
    ["", ["billing_amount:200"], "pro20x"],
    ["", ["price:20"], null],
    ["", ["credit_amount:50000"], null],
    ["", ["monthly:3", "amount:240"], null],
  ];

  for (const [raw, signals, expected] of cases) {
    it(`classifies raw=${JSON.stringify(raw)} signals=${JSON.stringify(signals)} as ${JSON.stringify(expected)}`, () => {
      expect(normalizeChatgptPlan(raw, { signals })).toBe(expected);
    });
  }
});

describe("planFromPriceNumber", () => {
  it("maps only the known price bands", () => {
    expect(planFromPriceNumber(89)).toBe(null);
    expect(planFromPriceNumber(90)).toBe("pro5x");
    expect(planFromPriceNumber(130)).toBe("pro5x");
    expect(planFromPriceNumber(131)).toBe(null);
    expect(planFromPriceNumber(189)).toBe(null);
    expect(planFromPriceNumber(190)).toBe("pro20x");
    expect(planFromPriceNumber(260)).toBe("pro20x");
    expect(planFromPriceNumber(261)).toBe(null);
  });

  it("accepts cents-encoded forms via n/100", () => {
    expect(planFromPriceNumber(10000)).toBe("pro5x");
    expect(planFromPriceNumber(20000)).toBe("pro20x");
  });

  it("rejects non-finite input", () => {
    expect(planFromPriceNumber(NaN)).toBe(null);
    expect(planFromPriceNumber(Infinity)).toBe(null);
  });
});

describe("CHATGPT_PLAN_RANK", () => {
  it("orders plans free < plus < pro5x < pro20x", () => {
    expect(CHATGPT_PLAN_RANK.free).toBeLessThan(CHATGPT_PLAN_RANK.plus);
    expect(CHATGPT_PLAN_RANK.plus).toBeLessThan(CHATGPT_PLAN_RANK.pro5x);
    expect(CHATGPT_PLAN_RANK.pro5x).toBeLessThan(CHATGPT_PLAN_RANK.pro20x);
  });
});

describe("geminiPlanFromTierLabel", () => {
  const cases: Array<[string | null | undefined, string | null]> = [
    ["Pro", "ai_pro"],
    ["PRO", "ai_pro"],
    ["Advanced", "ai_pro"],
    ["Plus", "ai_plus"],
    ["Ultra", "ai_ultra"],
    ["Free", "free"],
    ["free", "free"],
    ["", null],
    [null, null],
    [undefined, null],
    ["Workspace", null],
  ];
  for (const [label, expected] of cases) {
    it(`maps ${JSON.stringify(label)} → ${JSON.stringify(expected)}`, () => {
      expect(geminiPlanFromTierLabel(label)).toBe(expected);
    });
  }
});

describe("detectGeminiSubscription", () => {
  function stubGeminiDocument(nodes: Record<string, string | null>) {
    vi.stubGlobal("document", {
      querySelector: vi.fn((selector: string) => {
        const text = nodes[selector];
        return text == null ? null : { textContent: text };
      }),
    });
  }

  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the Gemini tier badge and current data-test-id model switcher", () => {
    stubGeminiDocument({
      ".mavatar-tier-label": "Pro",
      '[data-test-id="bard-mode-menu-button"]': "Flash",
    });

    expect(detectGeminiSubscription()).toEqual({ plan: "ai_pro", model: "Flash" });
  });

  it("falls back to the bard-mode-switcher model selector", () => {
    stubGeminiDocument({
      ".mavatar-tier-label": "Ultra",
      "bard-mode-switcher": "Gemini 3 Pro",
    });

    expect(detectGeminiSubscription()).toEqual({ plan: "ai_ultra", model: "Gemini 3 Pro" });
  });

  it("returns null when the tier badge is missing so stored plans are not clobbered", () => {
    stubGeminiDocument({
      '[data-test-id="bard-mode-menu-button"]': "Flash",
    });

    expect(detectGeminiSubscription()).toBeNull();
  });
});

describe("sendSubscriptionDetection no-clobber", () => {
  beforeEach(() => vi.mocked(send).mockClear());

  it("sends nothing when detection returns null, leaving any stored plan intact", () => {
    sendSubscriptionDetection("gemini", null);
    expect(send).not.toHaveBeenCalled();
  });

  it("sends the detected plan with price/label from PRICING", () => {
    sendSubscriptionDetection("gemini", { plan: "ai_pro", model: "Flash" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "insights-subscription",
        platform: "gemini",
        plan: "ai_pro",
        price: 19.99,
        label: "AI Pro",
      }),
    );
  });
});
