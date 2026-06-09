import { afterEach, describe, expect, it, vi } from "vitest";
import { applySendAnalytics, emptyPlatformDay, normalizeSends } from "../../src/background/usage";

// Local-noon timestamp so the derived hour is timezone-stable in CI.
function atHour(hour: number): number {
  const d = new Date();
  d.setHours(hour, 30, 0, 0);
  return d.getTime();
}

describe("applySendAnalytics", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("accumulates totals, rtl, words, chars and buckets sends by hour", () => {
    const day = emptyPlatformDay();
    applySendAnalytics(day, { lang: "rtl", words: 5, length: 30, timestamp: atHour(9) });
    applySendAnalytics(day, { lang: "other", words: 2, length: 10, timestamp: atHour(9) });
    applySendAnalytics(day, { lang: "hebrew", words: 1, length: 4, timestamp: atHour(13) });

    expect(day.sends).toEqual({
      total: 3,
      rtl: 2,
      totalWords: 8,
      totalChars: 44,
      byHour: { "9": 2, "13": 1 },
    });
  });

  it("preserves pre-existing sends including legacy hebrew counts", () => {
    const day = emptyPlatformDay();
    day.sends = { total: 4, hebrew: 3, totalWords: 9, totalChars: 90, byHour: { "8": 4 } } as never;
    applySendAnalytics(day, { lang: "other", words: 1, length: 2, timestamp: atHour(8) });
    expect(day.sends).toEqual({
      total: 5,
      rtl: 3,
      totalWords: 10,
      totalChars: 92,
      byHour: { "8": 5 },
    });
  });

  it("falls back to the current clock when the timestamp is missing", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 10, 22, 15, 0));
    const day = emptyPlatformDay();
    applySendAnalytics(day, {});
    expect(day.sends?.byHour).toEqual({ "22": 1 });
  });
});

describe("normalizeSends byHour passthrough", () => {
  it("preserves byHour when present and omits it otherwise", () => {
    expect(normalizeSends({ total: 1, byHour: { "9": 1 } }).byHour).toEqual({ "9": 1 });
    expect(normalizeSends({ total: 1 }).byHour).toBeUndefined();
    expect(normalizeSends(undefined).byHour).toBeUndefined();
  });
});
