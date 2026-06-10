import { describe, expect, it } from "vitest";
import {
  CHATGPT_CODEX_CREDITS_KEY,
  CHATGPT_CODEX_WORKSPACE_CREDITS_KEY,
  CHATGPT_CODEX_WORKSPACE_KEYS,
  CHATGPT_CODEX_WORKSPACE_THREADS_KEY,
  CHATGPT_CODEX_WORKSPACE_TURNS_KEY,
  GEMINI_CREDITS_KEY,
  GEMINI_ANTIGRAVITY_CREDITS_KEY,
  chatgptLimitMetricKey,
  chatgptModelMetricKey,
  geminiAntigravityModelMetricKey,
  geminiFeatureMetricKey,
} from "../../src/shared/metricKeys";

describe("shared metric keys", () => {
  it("builds provider usage metric keys consistently", () => {
    expect(chatgptModelMetricKey("gpt-5")).toBe("chatgpt:model:gpt-5");
    expect(chatgptLimitMetricKey("deep_research")).toBe("chatgpt:limit:deep_research");
    expect(geminiFeatureMetricKey(4)).toBe("gemini:feature:4");
    expect(geminiAntigravityModelMetricKey("claude-sonnet-4-5")).toBe("gemini:antigravity.model:claude-sonnet-4-5");
  });

  it("keeps codex, gemini, and antigravity aggregate keys stable", () => {
    expect(CHATGPT_CODEX_CREDITS_KEY).toBe("chatgpt:codex.credits");
    expect(CHATGPT_CODEX_WORKSPACE_THREADS_KEY).toBe("chatgpt:codex.workspace.threads");
    expect(CHATGPT_CODEX_WORKSPACE_TURNS_KEY).toBe("chatgpt:codex.workspace.turns");
    expect(CHATGPT_CODEX_WORKSPACE_CREDITS_KEY).toBe("chatgpt:codex.workspace.credits");
    expect(GEMINI_CREDITS_KEY).toBe("gemini:credits");
    expect(GEMINI_ANTIGRAVITY_CREDITS_KEY).toBe("gemini:antigravity.credits");
  });

  it("exports the workspace key group used by popup delta checks", () => {
    expect(CHATGPT_CODEX_WORKSPACE_KEYS).toEqual([
      CHATGPT_CODEX_WORKSPACE_TURNS_KEY,
      CHATGPT_CODEX_WORKSPACE_THREADS_KEY,
      CHATGPT_CODEX_WORKSPACE_CREDITS_KEY,
    ]);
  });
});
