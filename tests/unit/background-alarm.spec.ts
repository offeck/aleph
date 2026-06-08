import { afterEach, describe, expect, it, vi } from "vitest";

// Mock router's non-chrome deps so importing it doesn't pull in firebase/chrome
// at module load — we only want to exercise registerBackgroundListeners().
vi.mock("../../src/background/sync", () => ({
  alephSync: {
    restoreAuth: () => Promise.resolve(),
    processRetryQueue: () => Promise.resolve(),
    maybePush: () => {},
    signIn: () => Promise.resolve(),
    signOut: () => Promise.resolve(),
    getAuthState: () => Promise.resolve(),
    fullMergeAndSync: () => Promise.resolve(),
  },
}));
vi.mock("../../src/background/usage", () => ({
  readLocal: vi.fn(() => Promise.resolve(null)),
  writeLocal: vi.fn(() => Promise.resolve()),
  updateUsageDay: vi.fn(() => Promise.resolve()),
  ensurePlatformDay: vi.fn(),
  addNonNegative: vi.fn(),
  normalizeSends: vi.fn(),
  numberOrZero: vi.fn(),
}));
vi.mock("../../src/background/remarks", () => ({ generateRemark: vi.fn() }));
vi.mock("../../src/background/cleanup", () => ({ cleanupOldUsage: vi.fn() }));
vi.mock("../../src/background/providerUsage", () => ({
  refreshProviderUsage: vi.fn(() => Promise.resolve({ refreshed: false })),
  saveProviderUsageSnapshot: vi.fn(() => Promise.resolve()),
  LIMITS_REFRESH_ALARM: "aleph-refresh-limits",
  LIMITS_REFRESH_PERIOD_MINUTES: 20,
}));

import { registerBackgroundListeners } from "../../src/background/router";
import {
  LIMITS_REFRESH_ALARM,
  LIMITS_REFRESH_PERIOD_MINUTES,
  refreshProviderUsage,
} from "../../src/background/providerUsage";

function makeEvent() {
  const fns: Array<(...args: unknown[]) => void> = [];
  return {
    addListener: vi.fn((fn: (...args: unknown[]) => void) => { fns.push(fn); }),
    fire: (...args: unknown[]) => fns.forEach((fn) => fn(...args)),
  };
}

describe("background alarm wiring", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("creates the limits alarm on install/startup and refreshes provider usage on alarm", () => {
    const onInstalled = makeEvent();
    const onStartup = makeEvent();
    const onAlarm = makeEvent();
    const alarmsCreate = vi.fn();
    vi.stubGlobal("chrome", {
      runtime: { onInstalled, onStartup, onMessage: makeEvent(), onMessageExternal: makeEvent() },
      storage: { onChanged: makeEvent(), sync: { get: vi.fn() } },
      alarms: { onAlarm, create: alarmsCreate },
      commands: { onCommand: makeEvent() },
    });

    registerBackgroundListeners();

    // The alarm is created from install and startup (not on every worker boot,
    // which would perpetually reset its period).
    onInstalled.fire();
    expect(alarmsCreate).toHaveBeenCalledWith(LIMITS_REFRESH_ALARM, { periodInMinutes: LIMITS_REFRESH_PERIOD_MINUTES });
    alarmsCreate.mockClear();
    onStartup.fire();
    expect(alarmsCreate).toHaveBeenCalledWith(LIMITS_REFRESH_ALARM, { periodInMinutes: LIMITS_REFRESH_PERIOD_MINUTES });

    // The alarm fires a background refresh tagged "alarm" — the no-tab/no-popup path.
    onAlarm.fire({ name: LIMITS_REFRESH_ALARM });
    expect(refreshProviderUsage).toHaveBeenCalledWith("alarm");

    // Unrelated alarms are ignored.
    (refreshProviderUsage as ReturnType<typeof vi.fn>).mockClear();
    onAlarm.fire({ name: "some-other-alarm" });
    expect(refreshProviderUsage).not.toHaveBeenCalled();
  });
});
