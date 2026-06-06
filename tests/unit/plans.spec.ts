import { describe, expect, it } from "vitest";
import { CHATGPT_PLAN_RANK, normalizeChatgptPlan, planFromPriceNumber } from "../../src/tracker/plans";

describe("normalizeChatgptPlan", () => {
  // Fixture cases locked in during the PR #1 plan-price heuristic tightening:
  // junk numerics near amount/monthly keys must never classify a plan.
  const cases: Array<[string | null, string[], string | null]> = [
    ["plus", ["credit_amount:500"], "plus"],
    ["", ["amount:240"], null],
    [null, ["price:20000"], "pro20x"],
    [null, ["price:10000"], "pro5x"],
    ["pro", [], "pro5x"],
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
