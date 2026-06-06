import { describe, expect, it } from "vitest";
import { _mergeUsageDay } from "../../src/background/sync";

describe("_mergeUsageDay", () => {
  it("max-merges platform counters (never additive)", () => {
    const merged = _mergeUsageDay(
      { claude: { totalSeconds: 120, messageCount: 3, tokensIn: 100, tokensOut: 40 } },
      { claude: { totalSeconds: 90, messageCount: 5, tokensIn: 70, tokensOut: 60 } },
    );
    expect(merged.claude.totalSeconds).toBe(120);
    expect(merged.claude.messageCount).toBe(5);
    expect(merged.claude.tokensIn).toBe(100);
    expect(merged.claude.tokensOut).toBe(60);
  });

  it("strips firestore _lastModified and passes through unknown top-level fields (local wins)", () => {
    const merged = _mergeUsageDay(
      { extra: "local" },
      { _lastModified: 123, other: "remote", extra: "remote" },
    );
    expect(merged._lastModified).toBeUndefined();
    expect(merged.extra).toBe("local");
    expect(merged.other).toBe("remote");
  });

  it("merges hours per-slot with max", () => {
    const merged = _mergeUsageDay(
      { chatgpt: { hours: { "9": 600, "10": 60 } } },
      { chatgpt: { hours: { "10": 120, "11": 30 } } },
    );
    expect(merged.chatgpt.hours).toEqual({ "9": 600, "10": 120, "11": 30 });
  });

  it("merges sends with legacy hebrew fallback and drops all-zero sends", () => {
    const merged = _mergeUsageDay(
      { gemini: { sends: { total: 4, hebrew: 2 } } },
      { gemini: { sends: { total: 6, rtl: 1 } } },
    );
    expect(merged.gemini.sends).toEqual({ total: 6, rtl: 2, totalWords: 0, totalChars: 0 });

    const empty = _mergeUsageDay({ gemini: {} }, { gemini: {} });
    expect(empty.gemini.sends).toBeUndefined();
  });

  it("merges timing counters, preserves approximate, drops empty timing", () => {
    const merged = _mergeUsageDay(
      { claude: { timing: { count: 2, totalTTFT: 1000, approximate: true } } },
      { claude: { timing: { count: 3, totalTTFT: 800 } } },
    );
    expect(merged.claude.timing).toEqual({ count: 3, totalTTFT: 1000, approximate: true });

    const none = _mergeUsageDay({ claude: {} }, { claude: {} });
    expect(none.claude.timing).toBeUndefined();
  });

  it("prefers local estimateSource, then remote", () => {
    const localWins = _mergeUsageDay(
      { claude: { estimateSource: "provider" } },
      { claude: { estimateSource: "local" } },
    );
    expect(localWins.claude.estimateSource).toBe("provider");

    const remoteFallback = _mergeUsageDay(
      { claude: {} },
      { claude: { estimateSource: "remote-src" } },
    );
    expect(remoteFallback.claude.estimateSource).toBe("remote-src");
  });
});
