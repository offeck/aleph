import { describe, expect, it } from "vitest";
import { estimateTokens, IMG_TOKEN_COST, TOKEN_RATIOS } from "../../src/tracker/tokens";

// In node PLATFORM resolves to null, so estimateTokens falls back to the
// chatgpt ratios (latin 4.0, rtl 1.7, whitespace 5.5, code 2.5) — deterministic.

describe("estimateTokens", () => {
  it("returns 0 for empty input", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens(null)).toBe(0);
  });

  it("estimates Latin text at ~4 chars/token", () => {
    expect(estimateTokens("aaaa")).toBe(1);          // 4 / 4.0
    expect(estimateTokens("aaaaaaaa")).toBe(2);      // 8 / 4.0
  });

  it("estimates RTL-script text denser than Latin", () => {
    // 4 Hebrew letters / 1.7 = 2.35 → ceil 3 (vs 1 for 4 Latin chars)
    expect(estimateTokens("שלום")).toBe(3);
    expect(estimateTokens("שלום")).toBeGreaterThan(estimateTokens("abcd"));
  });

  it("counts whitespace at the cheap whitespace ratio", () => {
    // 8 latin + 1 ws = 8/4 + 1/5.5 = 2.18 → 3
    expect(estimateTokens("aaaa bbbb")).toBe(3);
  });

  it("prices code blocks with the code ratio", () => {
    // ```abcd``` = 10 chars / 2.5 = 4
    expect(estimateTokens("```abcd```")).toBe(4);
  });
});

describe("token cost tables", () => {
  it("covers all three platforms", () => {
    for (const table of [TOKEN_RATIOS, IMG_TOKEN_COST]) {
      expect(Object.keys(table).sort()).toEqual(["chatgpt", "claude", "gemini"]);
    }
  });
});
