import { describe, expect, it } from "vitest";
import { normalizeStoredPlan } from "../../src/insights/subscriptions";

describe("normalizeStoredPlan", () => {
  it("defaults to free for missing or plan-less subscriptions", () => {
    expect(normalizeStoredPlan("claude", null)).toBe("free");
    expect(normalizeStoredPlan("gemini", {})).toBe("free");
  });

  it("passes through plans that need no normalization", () => {
    expect(normalizeStoredPlan("claude", { plan: "max5x" })).toBe("max5x");
    expect(normalizeStoredPlan("gemini", { plan: "ai_pro" })).toBe("ai_pro");
    expect(normalizeStoredPlan("chatgpt", { plan: "plus" })).toBe("plus");
  });

  it("disambiguates the legacy chatgpt pro plan by stored price", () => {
    expect(normalizeStoredPlan("chatgpt", { plan: "pro", price: 200 })).toBe("pro20x");
    expect(normalizeStoredPlan("chatgpt", { plan: "pro", price: 100 })).toBe("pro5x");
    expect(normalizeStoredPlan("chatgpt", { plan: "pro" })).toBe("pro5x");
  });

  it("only remaps pro on chatgpt", () => {
    expect(normalizeStoredPlan("claude", { plan: "pro", price: 200 })).toBe("pro");
  });
});
