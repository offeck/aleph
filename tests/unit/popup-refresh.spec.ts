import { afterEach, describe, expect, it, vi } from "vitest";
import { loadInsights } from "../../src/popup/insightsView";
import {
  bindEvents,
  detectActivePlatform,
  loadSyncIndicator,
  loadUI,
} from "../../src/popup/ui";

vi.mock("../../src/popup/insightsView", () => ({ loadInsights: vi.fn() }));
vi.mock("../../src/popup/ui", () => ({
  bindEvents: vi.fn(),
  detectActivePlatform: vi.fn(),
  loadSyncIndicator: vi.fn(),
  loadUI: vi.fn(),
}));

describe("popup usage refresh", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("requests a background usage refresh on open and redraws after it completes", async () => {
    let domReady: (() => void) | null = null;
    vi.stubGlobal("document", {
      addEventListener: vi.fn((event: string, cb: () => void) => {
        if (event === "DOMContentLoaded") domReady = cb;
      }),
    });

    const sendMessage = vi.fn((_msg: unknown, cb: () => void) => { cb(); });
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
        lastError: undefined,
      },
    });

    await import("../../src/popup/index");
    expect(domReady).not.toBeNull();
    const runDomReady = domReady as unknown as () => void;
    runDomReady();

    expect(loadUI).toHaveBeenCalledTimes(1);
    expect(bindEvents).toHaveBeenCalledTimes(1);
    expect(loadInsights).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenCalledWith({ type: "insights-refresh-usage" }, expect.any(Function));
    expect(detectActivePlatform).toHaveBeenCalledTimes(1);
    expect(loadSyncIndicator).toHaveBeenCalledTimes(1);
  });

  it("redraws on usage-snapshot or subscription changes, ignoring unrelated keys", async () => {
    vi.useFakeTimers();
    let domReady: (() => void) | null = null;
    let storageCb: ((changes: Record<string, unknown>, area: string) => void) | null = null;
    vi.stubGlobal("document", {
      addEventListener: vi.fn((event: string, cb: () => void) => {
        if (event === "DOMContentLoaded") domReady = cb;
      }),
    });
    vi.stubGlobal("chrome", {
      runtime: { sendMessage: vi.fn((_msg: unknown, cb: () => void) => { cb(); }), lastError: undefined },
      storage: { onChanged: { addListener: vi.fn((cb: (changes: Record<string, unknown>, area: string) => void) => { storageCb = cb; }) } },
    });

    await import("../../src/popup/index");
    (domReady as unknown as () => void)();
    vi.clearAllMocks();

    expect(storageCb).not.toBeNull();
    const fire = (key: string) => {
      storageCb!({ [key]: { newValue: {} } }, "local");
      vi.advanceTimersByTime(60);
    };

    fire("insights_platform_usage_claude");
    expect(loadInsights).toHaveBeenCalledTimes(1);

    // A plan-only update writes insights_subscriptions, which must also redraw.
    fire("insights_subscriptions");
    expect(loadInsights).toHaveBeenCalledTimes(2);

    // Unrelated keys must not trigger a redraw.
    fire("some_unrelated_key");
    expect(loadInsights).toHaveBeenCalledTimes(2);
  });
});
