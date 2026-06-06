import { describe, expect, it } from "vitest";
import { boundedPercent, boundedRatio, normalizeCodexBalance } from "../../src/tracker/usageChatgpt";

describe("normalizeCodexBalance — explicit rate_limit shape", () => {
  it("reads primary/secondary windows as 5h and weekly limits", () => {
    const snapshot = normalizeCodexBalance({
      rate_limit: {
        primary_window: { used_percent: 37, resets_at: "2026-06-06T12:00:00Z" },
        secondary_window: { remaining_percent: 88 },
      },
    })!;
    expect(snapshot).not.toBeNull();
    const fiveHour = snapshot.limits.find((l) => l.period === "5h");
    const weekly = snapshot.limits.find((l) => l.period === "weekly");
    expect(fiveHour?.usedPct).toBe(37);
    expect(fiveHour?.remainingPct).toBe(63);
    expect(weekly?.remainingPct).toBe(88);
    expect(weekly?.usedPct).toBe(12);
  });

  it("collects per-model additional_rate_limits", () => {
    const snapshot = normalizeCodexBalance({
      additional_rate_limits: [
        { model: "gpt-5-codex", rate_limit: { primary_window: { used_percent: 50 } } },
      ],
    })!;
    const limit = snapshot.limits[0];
    expect(limit.model).toBe("gpt-5-codex");
    expect(limit.period).toBe("5h");
    expect(limit.usedPct).toBe(50);
  });

  it("skips the generic scanner when the explicit shape yields limits", () => {
    const snapshot = normalizeCodexBalance({
      rate_limit: { primary_window: { used_percent: 10 } },
      stats: { weekly_used_percent: 99 }, // scanner bait — must NOT be collected
    })!;
    expect(snapshot.limits.some((l) => l.usedPct === 99)).toBe(false);
    expect(snapshot.limits).toHaveLength(1);
  });

  it("dedups limits by model:period (first wins)", () => {
    const snapshot = normalizeCodexBalance({
      rate_limit: {
        primary_window: { used_percent: 10 },
        primaryWindow: { used_percent: 20 },
      },
    })!;
    expect(snapshot.limits).toHaveLength(1);
    expect(snapshot.limits[0].usedPct).toBe(10);
  });

  it("unwraps nested payload envelopes", () => {
    const snapshot = normalizeCodexBalance({
      data: { rate_limit: { primary_window: { used_percent: 25 } } },
    })!;
    expect(snapshot.limits[0].usedPct).toBe(25);
  });
});

describe("normalizeCodexBalance — generic scanner fallback", () => {
  it("collects scalar limits when no explicit shape exists", () => {
    const snapshot = normalizeCodexBalance({
      usage_stats: { weekly_used_percent: 80 },
    })!;
    const weekly = snapshot.limits.find((l) => l.period === "weekly");
    expect(weekly?.usedPct).toBe(80);
    expect(weekly?.remainingPct).toBe(20);
  });

  it("keeps remaining-flavored scalars as remaining (polarity regression)", () => {
    const snapshot = normalizeCodexBalance({
      quota: { weekly_usage_remaining_percent: 80 },
    })!;
    const weekly = snapshot.limits.find((l) => l.period === "weekly");
    expect(weekly?.remainingPct).toBe(80);
    expect(weekly?.usedPct).toBe(20);
  });

  it("treats ratio-named keys as 0..1 ratios and percent-named keys verbatim", () => {
    const ratio = normalizeCodexBalance({ usage: { five_hour_used_ratio: 0.5 } })!;
    expect(ratio.limits[0].usedPct).toBe(50);

    const percent = normalizeCodexBalance({ usage: { weekly_used_percent: 1 } })!;
    expect(percent.limits[0].usedPct).toBe(1); // 1% — NOT re-scaled to 100
  });
});

describe("normalizeCodexBalance — credits", () => {
  it("accepts numeric, object, and credit_balance forms", () => {
    expect(normalizeCodexBalance({ credits: 500 })!.credits).toEqual({ remaining: 500 });
    expect(normalizeCodexBalance({ credits: { remaining: 250 } })!.credits).toEqual({ remaining: 250 });
    expect(normalizeCodexBalance({ credit_balance: 42 })!.credits).toEqual({ remaining: 42 });
  });

  it("returns null for empty or garbage payloads", () => {
    expect(normalizeCodexBalance(null)).toBeNull();
    expect(normalizeCodexBalance(42)).toBeNull();
    expect(normalizeCodexBalance({})).toBeNull();
  });
});

describe("bounded percent/ratio helpers", () => {
  it("clamps and rejects non-numerics", () => {
    expect(boundedPercent(150)).toBe(100);
    expect(boundedPercent(-5)).toBe(0);
    expect(boundedPercent("abc")).toBe(null);
    expect(boundedPercent(null)).toBe(null);
  });

  it("scales 0..1 ratios but passes >1 values through", () => {
    expect(boundedRatio(0.37)).toBe(37);
    expect(boundedRatio(37)).toBe(37);
    expect(boundedRatio(1)).toBe(100); // by design: ratio-named keys treat 0..1 as fractions
  });
});
