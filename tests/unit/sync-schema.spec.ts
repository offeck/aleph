import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildRemoteUsageCache,
  buildRollupDoc,
  chunkOps,
  decideAdoption,
  isDateKey,
  makeKeyedThrottle,
  mergeSettings,
  mergeSubscriptions,
  rollupDocId,
  sumPlatformDays,
  sumUsageDays,
} from "../../src/background/syncSchema";

describe("sumPlatformDays", () => {
  it("adds counters elementwise (device rollups, never max)", () => {
    const sum = sumPlatformDays(
      { totalSeconds: 120, messageCount: 3, tokensIn: 100 },
      { totalSeconds: 90, messageCount: 5, tokensIn: 70, tokensOut: 60 },
    )!;
    expect(sum.totalSeconds).toBe(210);
    expect(sum.messageCount).toBe(8);
    expect(sum.tokensIn).toBe(170);
    expect(sum.tokensOut).toBe(60);
  });

  it("adds hours per slot", () => {
    const sum = sumPlatformDays(
      { hours: { "9": 600, "10": 60 } },
      { hours: { "10": 120, "11": 30 } },
    )!;
    expect(sum.hours).toEqual({ "9": 600, "10": 180, "11": 30 });
  });

  it("adds sends with legacy hebrew fallback and per-slot byHour", () => {
    const sum = sumPlatformDays(
      { sends: { total: 4, hebrew: 2, byHour: { "9": 4 } } },
      { sends: { total: 6, rtl: 1, totalWords: 30, byHour: { "9": 2, "13": 4 } } },
    )!;
    expect(sum.sends).toEqual({ total: 10, rtl: 3, totalWords: 30, totalChars: 0, byHour: { "9": 6, "13": 4 } });
  });

  it("drops all-zero sends and empty timing", () => {
    const sum = sumPlatformDays({ sends: {}, timing: {} }, { sends: {} })!;
    expect(sum.sends).toBeUndefined();
    expect(sum.timing).toBeUndefined();
  });

  it("adds timing counters and ORs approximate", () => {
    const sum = sumPlatformDays(
      { timing: { count: 2, totalTTFT: 1000 } },
      { timing: { count: 3, totalTTFT: 800, approximate: true } },
    )!;
    expect(sum.timing).toEqual({ count: 5, totalTTFT: 1800, totalThinking: 0, totalSendToThinking: 0, approximate: true });
  });

  it("prefers a's estimateSource and unknown extras", () => {
    const sum = sumPlatformDays(
      { estimateSource: "provider", extra: "mine" },
      { estimateSource: "local", extra: "theirs", other: "kept" },
    )!;
    expect(sum.estimateSource).toBe("provider");
    expect(sum.extra).toBe("mine");
    expect(sum.other).toBe("kept");
  });

  it("returns undefined when both sides are empty and tolerates nulls", () => {
    expect(sumPlatformDays(null, undefined)).toBeUndefined();
    expect(sumPlatformDays({}, {})).toBeUndefined();
    expect(sumPlatformDays(null, { totalSeconds: 5 })!.totalSeconds).toBe(5);
  });
});

describe("sumUsageDays", () => {
  it("unions platforms and strips _lastModified", () => {
    const sum = sumUsageDays(
      { claude: { totalSeconds: 10 }, _lastModified: 1 },
      { gemini: { totalSeconds: 20 } },
    );
    expect(sum.claude.totalSeconds).toBe(10);
    expect(sum.gemini.totalSeconds).toBe(20);
    expect(sum._lastModified).toBeUndefined();
  });
});

describe("buildRollupDoc", () => {
  it("builds the v2 doc shape from a local usage day", () => {
    const doc = buildRollupDoc(
      "dev-1234567890", "2026-06-10",
      { claude: { totalSeconds: 60, hours: { "9": 60 } } },
      "2.8.0", -180,
    )!;
    expect(doc).toEqual({
      schemaVersion: 2,
      deviceId: "dev-1234567890",
      date: "2026-06-10",
      tzOffsetMinutes: -180,
      appVersion: "2.8.0",
      platforms: { claude: { totalSeconds: 60, hours: { "9": 60 } } },
    });
    expect(rollupDocId(doc.deviceId, doc.date)).toBe("dev-1234567890_2026-06-10");
  });

  it("skips zero-activity platforms and returns null for empty days", () => {
    expect(buildRollupDoc("d", "2026-06-10", {}, "2.8.0", 0)).toBeNull();
    expect(buildRollupDoc("d", "2026-06-10", { claude: { totalSeconds: 0, hours: {} } }, "2.8.0", 0)).toBeNull();
    const doc = buildRollupDoc(
      "d", "2026-06-10",
      { claude: { totalSeconds: 0, hours: {} }, gemini: { messageCount: 1 }, _lastModified: 9 },
      "2.8.0", 0,
    )!;
    expect(Object.keys(doc.platforms)).toEqual(["gemini"]);
  });
});

describe("buildRemoteUsageCache", () => {
  it("ADDs other devices' rollups onto the legacy baseline and excludes own device", () => {
    const cache = buildRemoteUsageCache(
      [
        { deviceId: "me", date: "2026-06-10", platforms: { claude: { totalSeconds: 999 } } },
        { deviceId: "other", date: "2026-06-10", platforms: { claude: { totalSeconds: 30 } } },
        { deviceId: "third", date: "2026-06-10", platforms: { claude: { totalSeconds: 5 } } },
      ],
      { "2026-06-10": { claude: { totalSeconds: 100 }, _lastModified: 1 } },
      "me",
      "2026-03-01",
    );
    expect(cache["2026-06-10"].claude.totalSeconds).toBe(135);
    expect(cache["2026-06-10"]._lastModified).toBeUndefined();
  });

  it("prunes dates older than the cutoff and ignores malformed date keys", () => {
    const cache = buildRemoteUsageCache(
      [{ deviceId: "other", date: "2026-02-01", platforms: { claude: { totalSeconds: 1 } } }],
      { "2026-02-02": { claude: { totalSeconds: 1 } }, junk: { claude: { totalSeconds: 1 } } },
      "me",
      "2026-03-01",
    );
    expect(cache).toEqual({});
    expect(isDateKey("junk")).toBe(false);
  });
});

describe("mergeSettings", () => {
  it("resolves per key by newest stamp and reports remote wins via applyToLocal", () => {
    const result = mergeSettings(
      { theme: "nord", fontSize: 14 },
      { theme: 200, fontSize: 50 },
      { schemaVersion: 2, values: { theme: "dracula", fontSize: 12 }, updatedAtByKey: { theme: 100, fontSize: 90 } },
    );
    expect(result.values.theme).toBe("nord"); // local stamp newer
    expect(result.values.fontSize).toBe(12); // remote stamp newer
    expect(result.applyToLocal).toEqual({ fontSize: 12 });
    expect(result.stamps).toEqual({ theme: 200, fontSize: 90 });
    expect(result.shouldPush).toBe(true); // theme won locally → cloud must update

    const remoteWins = mergeSettings(
      { theme: "nord" },
      { theme: 100 },
      { schemaVersion: 2, values: { theme: "dracula" }, updatedAtByKey: { theme: 200 } },
    );
    expect(remoteWins.values.theme).toBe("dracula");
    expect(remoteWins.applyToLocal).toEqual({ theme: "dracula" });
    expect(remoteWins.stamps.theme).toBe(200);
    expect(remoteWins.shouldPush).toBe(false);
  });

  it("keeps local on unstamped ties and takes one-sided keys", () => {
    const result = mergeSettings(
      { theme: "nord" },
      {},
      { schemaVersion: 2, values: { theme: "dracula", fontSize: 12 }, updatedAtByKey: {} },
    );
    expect(result.values.theme).toBe("nord");
    expect(result.values.fontSize).toBe(12); // remote-only key adopted
    expect(result.applyToLocal).toEqual({ fontSize: 12 });
  });

  it("filters unknown keys on both sides (never uploads or applies junk)", () => {
    const result = mergeSettings(
      { theme: "nord", evil: "x" },
      {},
      { schemaVersion: 2, values: { hacked: true }, updatedAtByKey: { hacked: 99 } },
    );
    expect(result.values).toEqual({ theme: "nord" });
    expect(result.applyToLocal).toEqual({});
  });

  it("treats a legacy flat doc as unstamped values and forces a push", () => {
    const result = mergeSettings(
      { theme: "nord" },
      { theme: 5 },
      { theme: "dracula", fontSize: 12, updatedAtByKey: "not-a-values-doc" },
    );
    expect(result.values.theme).toBe("nord"); // local stamped > legacy 0
    expect(result.values.fontSize).toBe(12);
    expect(result.shouldPush).toBe(true);
  });

  it("pushes everything local when the cloud is empty, nothing when in sync", () => {
    const fresh = mergeSettings({ theme: "nord" }, { theme: 5 }, null);
    expect(fresh.values).toEqual({ theme: "nord" });
    expect(fresh.shouldPush).toBe(true);

    const settled = mergeSettings(
      { theme: "nord" },
      { theme: 5 },
      { schemaVersion: 2, values: { theme: "nord" }, updatedAtByKey: { theme: 5 } },
    );
    expect(settled.shouldPush).toBe(false);
    expect(settled.applyToLocal).toEqual({});
  });
});

describe("mergeSubscriptions", () => {
  it("manual override beats a newer auto-detection", () => {
    const merged = mergeSubscriptions(
      { claude: { plan: "pro", manualOverride: true, detectedAt: 100 } },
      { claude: { plan: "free", manualOverride: false, detectedAt: 999 } },
    );
    expect(merged.claude.plan).toBe("pro");
  });

  it("newer detectedAt wins otherwise; tie keeps local; one-sided passes through", () => {
    const merged = mergeSubscriptions(
      { claude: { plan: "old", detectedAt: 100 }, gemini: { plan: "ultra", detectedAt: 50 } },
      { claude: { plan: "new", detectedAt: 200 }, chatgpt: { plan: "plus", detectedAt: 10 }, _lastModified: 1 },
    );
    expect(merged.claude.plan).toBe("new");
    expect(merged.gemini.plan).toBe("ultra");
    expect(merged.chatgpt.plan).toBe("plus");
    expect(merged._lastModified).toBeUndefined();

    const tie = mergeSubscriptions(
      { claude: { plan: "local", detectedAt: 100 } },
      { claude: { plan: "remote", detectedAt: 100 } },
    );
    expect(tie.claude.plan).toBe("local");
  });
});

describe("decideAdoption", () => {
  it("covers all adoption states", () => {
    expect(decideAdoption({ adopted: true, legacyEmpty: false })).toEqual({ action: "none" });
    expect(decideAdoption({ adopted: true, legacyEmpty: true })).toEqual({ action: "none" });
    expect(decideAdoption({ adopted: false, legacyEmpty: true })).toEqual({ action: "adopt-fresh" });
    expect(decideAdoption({ adopted: false, legacyEmpty: false })).toEqual({ action: "seal-and-adopt" });
  });
});

describe("makeKeyedThrottle", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires leading immediately, coalesces churn into one trailing fire per key", () => {
    vi.useFakeTimers();
    const fired: string[] = [];
    const throttle = makeKeyedThrottle(60000, (key) => fired.push(key));

    throttle.touch("usage_2026-06-10");
    expect(fired).toEqual(["usage_2026-06-10"]); // leading edge

    throttle.touch("usage_2026-06-10");
    throttle.touch("usage_2026-06-10");
    throttle.touch("other");
    expect(fired).toEqual(["usage_2026-06-10", "other"]); // independent keys

    vi.advanceTimersByTime(59999);
    expect(fired).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(fired).toEqual(["usage_2026-06-10", "other", "usage_2026-06-10"]); // single trailing fire
  });

  it("respects the period after a trailing fire and supports cancelAll", () => {
    vi.useFakeTimers();
    const fired: string[] = [];
    const throttle = makeKeyedThrottle(60000, (key) => fired.push(key));

    throttle.touch("k");
    vi.advanceTimersByTime(30000);
    throttle.touch("k"); // schedules trailing at t=60s
    vi.advanceTimersByTime(30000);
    expect(fired).toEqual(["k", "k"]);

    throttle.touch("k"); // within period of trailing fire → schedules again
    throttle.cancelAll();
    vi.advanceTimersByTime(120000);
    expect(fired).toEqual(["k", "k"]); // canceled trailing never fires
  });
});

describe("chunkOps", () => {
  it("splits at the batch limit with headroom", () => {
    const ops = Array.from({ length: 501 }, (_, i) => i);
    const chunks = chunkOps(ops);
    expect(chunks.map((c) => c.length)).toEqual([450, 51]);
    expect(chunkOps([])).toEqual([]);
    expect(chunkOps([1, 2, 3], 2).map((c) => c.length)).toEqual([2, 1]);
  });
});
