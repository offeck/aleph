import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addCodexLimitMeter,
  addQuotaMeter,
  anyMetricChangedRecently,
  asNumber,
  cleanLabel,
  codexLimitLabel,
  computeTrend,
  detailWithReset,
  estimatedTokenTotal,
  METRIC_CHANGE_WINDOW_MS,
  metricChangedRecently,
  resetDetail,
  shortCodexModelLabel,
  sumCodexWorkspace,
  visibleUsageMeters,
  type Meter,
} from "../../src/popup/meters";

describe("pure helpers", () => {
  it("estimatedTokenTotal sums in/out and tolerates missing days", () => {
    expect(estimatedTokenTotal({ tokensIn: 10, tokensOut: 5 })).toBe(15);
    expect(estimatedTokenTotal(null)).toBe(0);
    expect(estimatedTokenTotal({})).toBe(0);
  });

  it("asNumber parses finite numbers only", () => {
    expect(asNumber("42")).toBe(42);
    expect(asNumber(0)).toBe(0);
    expect(asNumber("soon")).toBeNull();
    expect(asNumber(undefined)).toBeNull();
  });

  it("cleanLabel title-cases and de-snake-cases with fallback", () => {
    expect(cleanLabel("deep_research")).toBe("Deep Research");
    expect(cleanLabel("gpt-4o")).toBe("Gpt 4o");
    expect(cleanLabel(null, "GPT")).toBe("GPT");
    expect(cleanLabel(null)).toBe("Usage");
  });

  it("shortCodexModelLabel strips GPT/Codex prefixes", () => {
    expect(shortCodexModelLabel("gpt-5-codex")).toBe("codex");
    expect(shortCodexModelLabel("codex-mini-latest")).toBe("Codex mini latest");
    expect(shortCodexModelLabel(null)).toBe("Codex");
  });

  it("codexLimitLabel maps weekly to 7d and falls back to the period", () => {
    expect(codexLimitLabel({ period: "weekly" })).toBe("Codex 7d");
    expect(codexLimitLabel({ period: "monthly" })).toBe("Codex monthly");
    expect(codexLimitLabel({})).toBe("Codex limit");
    expect(codexLimitLabel({ model: "gpt-5-codex", period: "weekly" })).toBe("codex 7d");
  });

  it("computeTrend classifies up/down/flat with a 5% deadband and zero-previous guard", () => {
    expect(computeTrend(200, 100)).toEqual({ pct: 100, dir: "up" });
    expect(computeTrend(90, 100)).toEqual({ pct: -10, dir: "down" });
    expect(computeTrend(102, 100)).toEqual({ pct: 2, dir: "flat" });
    expect(computeTrend(50, 0)).toEqual({ pct: 0, dir: "flat" });
  });
});

describe("metric change windows", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("metricChangedRecently honors the 24h window edge", () => {
    const usage = { metricChanges: { k: { changedAt: 1000 } } };
    vi.setSystemTime(1000 + METRIC_CHANGE_WINDOW_MS);
    expect(metricChangedRecently(usage, "k")).toBe(true);
    vi.setSystemTime(1000 + METRIC_CHANGE_WINDOW_MS + 1);
    expect(metricChangedRecently(usage, "k")).toBe(false);
    expect(metricChangedRecently({}, "k")).toBe(false);
    expect(metricChangedRecently(null, "k")).toBe(false);
  });

  it("anyMetricChangedRecently matches when any key is recent", () => {
    vi.setSystemTime(5000);
    const usage = { metricChanges: { b: { changedAt: 4000 } } };
    expect(anyMetricChangedRecently(usage, ["a", "b"])).toBe(true);
    expect(anyMetricChangedRecently(usage, ["a", "c"])).toBe(false);
  });
});

describe("reset details", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-08T10:00:00.000Z"));
  });
  afterEach(() => { vi.useRealTimers(); });

  it("formats ISO reset timestamps as countdowns with an exact-time title", () => {
    const reset = resetDetail({ resetsAt: "2026-06-08T12:30:00.000Z" });
    expect(reset?.text).toBe("resets 2h 30m");
    expect(reset?.title).toContain("Resets at");
  });

  it("formats duration-style reset values and ignores invalid values", () => {
    expect(resetDetail({ reset_after: "6m0s" })?.text).toBe("resets 6m");
    expect(resetDetail({ resetAfterSeconds: 90 })?.text).toBe("resets 2m");
    expect(resetDetail({ resetAfterSeconds: "90" })?.text).toBe("resets 2m");
    expect(resetDetail({ resetTime: String(Date.parse("2026-06-08T11:00:00.000Z") / 1000) })?.text).toBe("resets 1h");
    expect(resetDetail({ resetsAt: "not-a-date" })).toBeNull();
  });

  it("keeps reset text separate from existing meter details", () => {
    expect(detailWithReset("25%", { resetsAt: "2026-06-08T11:00:00.000Z" })).toMatchObject({
      detail: "25%",
      reset: "resets 1h",
    });
    expect(detailWithReset("25%", {})).toEqual({ detail: "25%" });
  });
});

describe("addQuotaMeter", () => {
  it("builds a percentage meter from used/limit and clamps to 0-100", () => {
    const target: Meter[] = [];
    addQuotaMeter(target, "ChatGPT GPT-5", { limit: 100, used: 25 }, "#4285F4");
    addQuotaMeter(target, "Clamped", { limit: 10, used: 25 }, "#4285F4");
    expect(target[0]).toMatchObject({ label: "ChatGPT GPT-5", pct: 25, quota: true, fullAvailable: false });
    expect(target[1].pct).toBe(100);
  });

  it("adds reset countdown details to percentage meters", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-08T10:00:00.000Z"));
    const target: Meter[] = [];
    addQuotaMeter(target, "Gemini credits", { limit: 100, remaining: 75, resetsAt: "2026-06-08T14:00:00.000Z" }, "#10A37F");
    expect(target[0]).toMatchObject({ pct: 25, detail: "25%", reset: "resets 4h" });
    expect(target[0].title).toContain("Resets at");
    vi.useRealTimers();
  });

  it("derives used from remaining and flags fully available quotas", () => {
    const target: Meter[] = [];
    addQuotaMeter(target, "Fresh", { limit: 100, remaining: 100 }, "#10A37F");
    expect(target[0]).toMatchObject({ pct: 0, fullAvailable: true });
  });

  it("skips limit-only items and emits detail rows for remaining-only items", () => {
    const target: Meter[] = [];
    addQuotaMeter(target, "NoData", { limit: 100 }, "#fff");
    expect(target).toHaveLength(0);

    addQuotaMeter(target, "Credits", { remaining: 7 }, "#fff", { requiresRecentDelta: true, changedWithin24h: true });
    expect(target[0]).toMatchObject({ pct: null, detail: "7 left", requiresRecentDelta: true, changedWithin24h: true });

    addQuotaMeter(target, "Empty", {}, "#fff");
    expect(target).toHaveLength(1);
  });

  it("adds reset countdown details to remaining-only meters", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-08T10:00:00.000Z"));
    const target: Meter[] = [];
    addQuotaMeter(target, "Credits", { remaining: 7, reset_after: "1h30m" }, "#fff");
    expect(target[0]).toMatchObject({ pct: null, detail: "7 left", reset: "resets 1h 30m" });
    vi.useRealTimers();
  });
});

describe("addCodexLimitMeter", () => {
  it("prefers usedPct, derives from remainingPct, and skips when neither exists", () => {
    const target: Meter[] = [];
    addCodexLimitMeter(target, { usedPct: 30, period: "weekly" }, "#4285F4");
    addCodexLimitMeter(target, { remainingPct: 25 }, "#4285F4");
    addCodexLimitMeter(target, {}, "#4285F4");
    expect(target).toHaveLength(2);
    expect(target[0]).toMatchObject({ label: "Codex 7d", pct: 30, fullAvailable: false });
    expect(target[1]).toMatchObject({ label: "Codex limit", pct: 75 });
  });

  it("flags fully available when nothing is used", () => {
    const target: Meter[] = [];
    addCodexLimitMeter(target, { remainingPct: 100 }, "#4285F4");
    expect(target[0]).toMatchObject({ pct: 0, fullAvailable: true });
  });

  it("adds reset countdown details to Codex limit meters", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-08T10:00:00.000Z"));
    const target: Meter[] = [];
    addCodexLimitMeter(target, { usedPct: 30, period: "5h", resets_at: "2026-06-08T10:45:00.000Z" }, "#4285F4");
    expect(target[0]).toMatchObject({ label: "Codex 5h", pct: 30, detail: "30%", reset: "resets 45m" });
    vi.useRealTimers();
  });
});

describe("visibleUsageMeters", () => {
  it("collapses fully available quota rows to the provided fallback", () => {
    const fallback: Meter = { label: "Codex", pct: 0, color: "#4285F4", alwaysShow: true, quota: true, fullAvailable: true };
    expect(visibleUsageMeters([
      { label: "Codex 5h", pct: 0, color: "#4285F4", alwaysShow: true, quota: true, fullAvailable: true },
      { label: "Codex 7d", pct: 0, color: "#4285F4", alwaysShow: true, quota: true, fullAvailable: true },
    ], fallback)).toEqual([fallback]);
  });

  it("keeps active quota rows and recently changed detail rows", () => {
    expect(visibleUsageMeters([
      { label: "Codex 5h", pct: 12, color: "#4285F4", alwaysShow: true, quota: true },
      { label: "Codex credits", pct: null, detail: "0 left", color: "#4285F4", alwaysShow: true, requiresRecentDelta: true, changedWithin24h: true },
      { label: "Old credits", pct: null, detail: "9 left", color: "#4285F4", alwaysShow: true, requiresRecentDelta: true, changedWithin24h: false },
    ])).toMatchObject([
      { label: "Codex 5h", pct: 12 },
      { label: "Codex credits", detail: "0 left" },
    ]);
  });
});

describe("sumCodexWorkspace", () => {
  it("sums totals across workspace rows", () => {
    expect(sumCodexWorkspace({
      data: [
        { totals: { threads: 2, turns: 10, credits: 30 } },
        { totals: { threads: 1, turns: 5, credits: 20 } },
      ],
    })).toEqual({ threads: 3, turns: 15, credits: 50 });
  });

  it("returns null for empty, zero, or malformed data", () => {
    expect(sumCodexWorkspace({ data: [] })).toBeNull();
    expect(sumCodexWorkspace({ data: [{ totals: { threads: 0, turns: 0, credits: 0 } }] })).toBeNull();
    expect(sumCodexWorkspace(null)).toBeNull();
    expect(sumCodexWorkspace({ data: "nope" })).toBeNull();
  });
});
