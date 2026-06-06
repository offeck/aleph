import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectUsageMetricValues,
  updateUsageMetricChanges,
  USAGE_METRIC_CHANGE_WINDOW_MS,
} from "../../src/background/metrics";

describe("collectUsageMetricValues", () => {
  it("collects chatgpt model/limit/codex metrics from a chat-wrapped snapshot", () => {
    const usage = {
      chat: {
        modelLimits: [
          { model: "gpt-5", remaining: 42 },
          { name: "o3", used: 7 },
        ],
        limits: [{ feature: "deep_research", remaining: 9 }],
      },
      codex: {
        analytics: {
          credits: { remaining: 250 },
          dailyWorkspaceUsage: {
            data: [
              { totals: { threads: 2, turns: 10, credits: 30 } },
              { totals: { threads: 1, turns: 5, credits: 20 } },
            ],
          },
        },
      },
    };
    expect(collectUsageMetricValues("chatgpt", usage)).toEqual({
      "chatgpt:model:gpt-5": 42,
      "chatgpt:model:o3": 7,
      "chatgpt:limit:deep_research": 9,
      "chatgpt:codex.credits": 250,
      "chatgpt:codex.workspace.threads": 3,
      "chatgpt:codex.workspace.turns": 15,
      "chatgpt:codex.workspace.credits": 50,
    });
  });

  it("accepts the legacy unwrapped chatgpt shape (usage.chat || usage)", () => {
    expect(collectUsageMetricValues("chatgpt", { modelLimits: [{ model: "gpt-4", remaining: 1 }] }))
      .toEqual({ "chatgpt:model:gpt-4": 1 });
  });

  it("collects gemini credits and per-feature metrics", () => {
    expect(collectUsageMetricValues("gemini", {
      credits: { remaining: 950 },
      features: [{ id: 4, remaining: 12 }, { id: 15, used: 3 }],
    })).toEqual({
      "gemini:credits": 950,
      "gemini:feature:4": 12,
      "gemini:feature:15": 3,
    });
  });

  it("returns empty for null usage, unknown platforms, and non-numeric values", () => {
    expect(collectUsageMetricValues("chatgpt", null)).toEqual({});
    expect(collectUsageMetricValues("claude", { credits: { remaining: 10 } })).toEqual({});
    expect(collectUsageMetricValues("gemini", { credits: { remaining: "soon" } })).toEqual({});
  });
});

describe("updateUsageMetricChanges", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("returns values without changes on the first snapshot", () => {
    vi.setSystemTime(1_000_000);
    const result = updateUsageMetricChanges("gemini", null, { credits: { remaining: 100 } });
    expect(result.metricValues).toEqual({ "gemini:credits": 100 });
    expect(result.metricChanges).toEqual({});
  });

  it("records previous/current when a value moves", () => {
    vi.setSystemTime(1_000_000);
    const first = updateUsageMetricChanges("gemini", null, { credits: { remaining: 100 } });
    vi.setSystemTime(1_500_000);
    const second = updateUsageMetricChanges("gemini", first, { credits: { remaining: 81 } });
    expect(second.metricChanges["gemini:credits"]).toEqual({
      changedAt: 1_500_000,
      previous: 100,
      current: 81,
    });
  });

  it("carries changedAt forward while unchanged and expires it after the 24h window", () => {
    vi.setSystemTime(1_000_000);
    const first = updateUsageMetricChanges("gemini", null, { credits: { remaining: 100 } });
    vi.setSystemTime(2_000_000);
    const second = updateUsageMetricChanges("gemini", first, { credits: { remaining: 50 } });
    expect(second.metricChanges["gemini:credits"].changedAt).toBe(2_000_000);

    vi.setSystemTime(2_500_000);
    const third = updateUsageMetricChanges("gemini", second, { credits: { remaining: 50 } });
    expect(third.metricChanges["gemini:credits"]).toEqual({
      changedAt: 2_000_000,
      previous: 100,
      current: 50,
    });

    vi.setSystemTime(2_000_000 + USAGE_METRIC_CHANGE_WINDOW_MS + 1);
    const fourth = updateUsageMetricChanges("gemini", third, { credits: { remaining: 50 } });
    expect(fourth.metricChanges["gemini:credits"]).toBeUndefined();
    expect(fourth.metricValues["gemini:credits"]).toBe(50);
  });
});
