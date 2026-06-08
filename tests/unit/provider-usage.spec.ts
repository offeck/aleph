import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetProviderUsageRefreshStateForTests,
  chatgptPlanTypeRaw,
  extractClaudeOrgId,
  inferGeminiPlanFromQuotas,
  normalizeClaudePlanFromOrg,
  parseGeminiSessionData,
  prepareProviderUsageSnapshot,
  refreshProviderUsage,
  shouldRefreshUsage,
} from "../../src/background/providerUsage";

type Stored = Record<string, unknown>;

function makeJsonResponse(data: unknown) {
  return {
    ok: true,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(typeof data === "string" ? data : JSON.stringify(data)),
  } as Response;
}

function installChromeStorage(storage: Stored) {
  const get = vi.fn(async (defaults: Record<string, unknown>) => {
    const out: Stored = {};
    for (const [key, fallback] of Object.entries(defaults)) {
      out[key] = key in storage ? storage[key] : fallback;
    }
    return out;
  });
  const set = vi.fn(async (update: Stored) => { Object.assign(storage, update); });
  vi.stubGlobal("chrome", {
    storage: { local: { get, set } },
    cookies: {
      get: vi.fn((_details: chrome.cookies.CookieDetails, cb: (cookie: Partial<chrome.cookies.Cookie>) => void) => {
        cb({ value: "org-claude" });
      }),
    },
  });
  return { get, set };
}

function installProviderFetch() {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://chatgpt.com/api/auth/session") {
      return Promise.resolve(makeJsonResponse({
        accessToken: "chat-token",
        account: { planType: "plus" },
      }));
    }
    if (url === "https://chatgpt.com/backend-api/conversation/init") {
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>)?.Authorization).toBe("Bearer chat-token");
      return Promise.resolve(makeJsonResponse({
        limits_progress: [{ feature_name: "deep_research", remaining: 8, limit: 10 }],
        model_limits: [{ model_slug: "gpt-5", remaining: 40, limit: 50 }],
      }));
    }
    if (url === "https://chatgpt.com/backend-api/wham/usage") {
      expect((init?.headers as Record<string, string>)?.Authorization).toBe("Bearer chat-token");
      return Promise.resolve(makeJsonResponse({
        rate_limit: {
          primary_window: { used_percent: 20 },
          secondary_window: { remaining_percent: 75 },
        },
        credits: 7,
      }));
    }
    if (url === "https://claude.ai/api/organizations/org-claude/usage") {
      return Promise.resolve(makeJsonResponse({
        five_hour: { utilization: 12, resets_at: "2026-06-08T12:00:00.000Z" },
        seven_day: { utilization: 33, resets_at: "2026-06-09T12:00:00.000Z" },
      }));
    }
    if (url === "https://claude.ai/api/organizations/org-claude") {
      return Promise.resolve(makeJsonResponse({ rate_limit_tier: "default_claude_max_5x" }));
    }
    if (url === "https://gemini.google.com/app") {
      return Promise.resolve(makeJsonResponse(`
        <script>WIZ_global_data={FdrFJe:"sid-123",SNlM0e:"at-token"}</script>
        <script src="/_/mss/boq_assistant-bard-web-server_20260608.01_p0/main.js"></script>
      `));
    }
    if (url.startsWith("https://gemini.google.com/_/BardChatUi/data/batchexecute")) {
      expect(url).toContain("rpcids=qpEbW");
      expect(url).toContain("source-path=%2Fapp");
      expect(url).toContain("bl=boq_assistant-bard-web-server_20260608.01_p0");
      expect(url).toContain("f.sid=sid-123");
      expect(url).toContain("_reqid=123456");
      expect(init?.method).toBe("POST");
      expect(String(init?.body)).toContain("qpEbW");
      expect(String(init?.body)).toContain("at-token");
      const quotas = [[[null, 2, 0, [1780679819, 0], 100, 90]]];
      return Promise.resolve(makeJsonResponse(JSON.stringify([["wrb.fr", "qpEbW", JSON.stringify(quotas)]])));
    }
    throw new Error("unexpected fetch " + url);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("prepareProviderUsageSnapshot", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("preserves previous ChatGPT chat limits when a lightweight Codex refresh omits them", () => {
    vi.setSystemTime(1_000_000);
    const previous = {
      chat: {
        limits: [{ feature: "deep_research", remaining: 8 }],
        modelLimits: [{ model: "gpt-5", remaining: 40 }],
      },
      limits: [{ feature: "deep_research", remaining: 8 }],
      modelLimits: [{ model: "gpt-5", remaining: 40 }],
      codex: {
        dailyWorkspaceUsage: { data: [{ totals: { turns: 5 } }] },
        analytics: { credits: { remaining: 10 }, limits: [] },
      },
      metricValues: {
        "chatgpt:model:gpt-5": 40,
        "chatgpt:limit:deep_research": 8,
      },
      metricChanges: {},
    };

    const next = prepareProviderUsageSnapshot("chatgpt", previous, {
      source: "provider",
      codex: {
        balance: { credits: 7 },
        analytics: { credits: { remaining: 7 }, limits: [] },
      },
    });

    expect(next.chat).toBe(previous.chat);
    expect(next.limits).toBe(previous.limits);
    expect(next.modelLimits).toBe(previous.modelLimits);
    expect(next.codex.dailyWorkspaceUsage).toBe(previous.codex.dailyWorkspaceUsage);
    expect(next.codex.balance).toEqual({ credits: 7 });
    expect(next.fetchedAt).toBe(1_000_000);
  });
});

describe("shouldRefreshUsage", () => {
  it("refreshes when there is no snapshot or no fetchedAt", () => {
    expect(shouldRefreshUsage(null, 1_000_000, 60_000)).toBe(true);
    expect(shouldRefreshUsage({}, 1_000_000, 60_000)).toBe(true);
  });
  it("skips while the snapshot is within the freshness window", () => {
    expect(shouldRefreshUsage({ fetchedAt: 970_000 }, 1_000_000, 60_000)).toBe(false);
  });
  it("refreshes at or past the freshness window", () => {
    expect(shouldRefreshUsage({ fetchedAt: 940_000 }, 1_000_000, 60_000)).toBe(true);
    expect(shouldRefreshUsage({ fetchedAt: 939_000 }, 1_000_000, 60_000)).toBe(true);
  });
});

describe("extractClaudeOrgId", () => {
  it("finds organization ids in known Claude organization payload shapes", () => {
    expect(extractClaudeOrgId({ organizations: [{ uuid: "org-1" }] })).toBe("org-1");
    expect(extractClaudeOrgId({ data: [{ id: "org-2" }] })).toBe("org-2");
  });

  it("prefers a nested org id over a wrapper's own generic id", () => {
    // A wrapper carrying its own unrelated id must not shadow the real org.
    expect(extractClaudeOrgId({ id: "account-x", organizations: [{ uuid: "org-1" }] })).toBe("org-1");
    // An unambiguous org key on the wrapper still wins over nested collections.
    expect(extractClaudeOrgId({ organization_uuid: "org-A", organizations: [{ uuid: "org-B" }] })).toBe("org-A");
  });
});

describe("normalizeClaudePlanFromOrg", () => {
  it("maps Claude organization rate-limit tiers to stored plan ids", () => {
    expect(normalizeClaudePlanFromOrg({ rate_limit_tier: "default_claude_pro" })).toBe("pro");
    expect(normalizeClaudePlanFromOrg({ rate_limit_tier: "default_claude_max_5x" })).toBe("max5x");
    expect(normalizeClaudePlanFromOrg({ rate_limit_tier: "default_claude_max_20x" })).toBe("max20x");
  });
});

describe("parseGeminiSessionData", () => {
  it("extracts the session id, anti-CSRF token, and build label from app HTML", () => {
    const html = `
      <script>
        var WIZ_global_data = {
          FdrFJe: "sid-123",
          SNlM0e: "at-token"
        };
      </script>
      <script src="/_/mss/boq_assistant-bard-web-server_20260608.01_p0/main.js"></script>
    `;

    expect(parseGeminiSessionData(html)).toEqual({
      sid: "sid-123",
      at: "at-token",
      bl: "boq_assistant-bard-web-server_20260608.01_p0",
    });
  });
});

describe("inferGeminiPlanFromQuotas", () => {
  it("asserts ai_ultra only on the Ultra-only feature, else leaves the plan unknown", () => {
    expect(inferGeminiPlanFromQuotas([{ id: 12, name: "Ultra Only", limit: 1, remaining: 1, resetsAt: null }])).toBe("ai_ultra");
    // A credit pool / non-Ultra feature rows must NOT be treated as paid — free
    // accounts also report a daily credit pool and feature rows.
    expect(inferGeminiPlanFromQuotas([{ id: 4, name: "Pro 3.1", limit: 100, remaining: 90, resetsAt: null }])).toBe(null);
    expect(inferGeminiPlanFromQuotas([])).toBe(null);
  });
});

describe("chatgptPlanTypeRaw (API-shape canary)", () => {
  it("returns the raw planType only when present and non-empty", () => {
    expect(chatgptPlanTypeRaw({ account: { planType: "prolite" } })).toBe("prolite");
    expect(chatgptPlanTypeRaw({ account: { planType: "plus" } })).toBe("plus");
  });

  it("returns null when there is nothing to flag as drift", () => {
    expect(chatgptPlanTypeRaw({ account: { planType: "" } })).toBe(null);
    expect(chatgptPlanTypeRaw({ account: {} })).toBe(null);
    expect(chatgptPlanTypeRaw({})).toBe(null);
    expect(chatgptPlanTypeRaw(null)).toBe(null);
    expect(chatgptPlanTypeRaw("guest")).toBe(null);
  });
});

describe("refreshProviderUsage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    _resetProviderUsageRefreshStateForTests(() => 123456);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("fetches ChatGPT, Claude, and Gemini provider limits from the background and persists snapshots", async () => {
    const storage: Stored = {};
    installChromeStorage(storage);
    const fetchMock = installProviderFetch();

    const result = await refreshProviderUsage();

    expect(result.refreshed).toBe(true);
    expect(result.platforms?.chatgpt?.refreshed).toBe(true);
    expect(result.platforms?.claude?.refreshed).toBe(true);
    expect(result.platforms?.gemini?.refreshed).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("https://chatgpt.com/api/auth/session", expect.any(Object));

    expect(storage.insights_platform_usage_chatgpt).toMatchObject({
      source: "provider",
      fetchedAt: 1_000_000,
      limits: [{ feature: "deep_research", remaining: 8, limit: 10 }],
      modelLimits: [{ model: "gpt-5", remaining: 40, limit: 50 }],
      codex: {
        analytics: {
          credits: { remaining: 7 },
        },
      },
    });
    expect(storage.insights_platform_usage_claude).toMatchObject({
      source: "provider",
      fiveHour: { utilization: 12, resetsAt: "2026-06-08T12:00:00.000Z" },
      sevenDay: { utilization: 33, resetsAt: "2026-06-09T12:00:00.000Z" },
    });
    expect(storage.insights_platform_usage_gemini).toMatchObject({
      source: "provider",
      credits: { limit: 100, remaining: 90, used: 10 },
      buildLabel: "boq_assistant-bard-web-server_20260608.01_p0",
    });
    expect(storage.insights_subscriptions).toMatchObject({
      chatgpt: {
        plan: "plus",
        price: 20,
        label: "Plus",
        model: null,
        detectedAt: 1_000_000,
        manualOverride: false,
      },
      claude: {
        plan: "max5x",
        price: 100,
        label: "Max 5x",
        model: null,
        detectedAt: 1_000_000,
        manualOverride: false,
      },
    });
    // Gemini's quota mock is a credit pool only (no Ultra signal), so conservative
    // inference leaves its plan unknown and no Gemini subscription is written.
    expect((storage.insights_subscriptions as Stored).gemini).toBeUndefined();
  });

  it("throttles repeated popup refreshes after a successful provider fetch", async () => {
    const storage: Stored = {};
    installChromeStorage(storage);
    const fetchMock = installProviderFetch();

    await refreshProviderUsage();
    fetchMock.mockClear();
    const result = await refreshProviderUsage();

    expect(result.refreshed).toBe(false);
    expect(result.platforms?.chatgpt).toEqual({ refreshed: false, reason: "throttled" });
    expect(result.platforms?.claude).toEqual({ refreshed: false, reason: "throttled" });
    expect(result.platforms?.gemini).toEqual({ refreshed: false, reason: "throttled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not overwrite manually overridden subscription plans", async () => {
    const storage: Stored = {
      insights_subscriptions: {
        chatgpt: {
          plan: "pro20x",
          price: 200,
          label: "Pro 20x",
          model: null,
          detectedAt: 500,
          manualOverride: true,
        },
      },
    };
    installChromeStorage(storage);
    installProviderFetch();

    await refreshProviderUsage();

    expect((storage.insights_subscriptions as Stored).chatgpt).toEqual({
      plan: "pro20x",
      price: 200,
      label: "Pro 20x",
      model: null,
      detectedAt: 500,
      manualOverride: true,
    });
  });

  it("uses a longer freshness window for the alarm than the popup", async () => {
    // 10 minutes old: stale for a popup (~60s) but still fresh for the alarm (~15min).
    const tenMinOld = 1_000_000 - 10 * 60 * 1000;
    installChromeStorage({
      insights_platform_usage_chatgpt: { source: "provider", fetchedAt: tenMinOld },
      insights_platform_usage_claude: { source: "provider", fetchedAt: tenMinOld },
      insights_platform_usage_gemini: { source: "provider", fetchedAt: tenMinOld },
      // Subscriptions already exist, so the gate weighs only usage freshness.
      insights_subscriptions: {
        chatgpt: { plan: "plus", detectedAt: tenMinOld, manualOverride: false },
        claude: { plan: "max5x", detectedAt: tenMinOld, manualOverride: false },
        gemini: { plan: "ai_ultra", detectedAt: tenMinOld, manualOverride: false },
      },
    });
    const fetchMock = installProviderFetch();

    const result = await refreshProviderUsage("alarm");

    expect(result.refreshed).toBe(false);
    expect(result.platforms?.claude).toEqual({ refreshed: false, reason: "throttled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches a plan-reliable platform with a missing subscription even when usage is fresh", async () => {
    const storage: Stored = {
      insights_platform_usage_chatgpt: { source: "provider", fetchedAt: 1_000_000 },
      insights_platform_usage_claude: { source: "provider", fetchedAt: 1_000_000 },
      insights_platform_usage_gemini: { source: "provider", fetchedAt: 1_000_000 },
      // chatgpt already has a plan; claude's subscription is missing (e.g. a
      // prior cycle's plan endpoint failed). gemini has no plan by design.
      insights_subscriptions: {
        chatgpt: { plan: "plus", detectedAt: 1_000_000, manualOverride: false },
      },
    };
    installChromeStorage(storage);
    const fetchMock = installProviderFetch();

    await refreshProviderUsage("popup");

    // Claude (plan-reliable, missing subscription) is fetched despite fresh usage;
    // chatgpt (has a plan) and gemini (best-effort plan) stay throttled.
    expect(fetchMock).toHaveBeenCalledWith("https://claude.ai/api/organizations/org-claude", expect.any(Object));
    expect(fetchMock).not.toHaveBeenCalledWith("https://chatgpt.com/api/auth/session", expect.any(Object));
    expect(fetchMock).not.toHaveBeenCalledWith("https://gemini.google.com/app", expect.any(Object));
    expect((storage.insights_subscriptions as Stored).claude).toMatchObject({ plan: "max5x" });
  });

  it("keeps a content-detected model when background plan detection has none", async () => {
    const storage: Stored = {
      insights_subscriptions: {
        claude: { plan: "pro", price: 20, label: "Pro", model: "Claude Opus 4.5", detectedAt: 500, manualOverride: false },
      },
    };
    installChromeStorage(storage);
    installProviderFetch();

    await refreshProviderUsage();

    expect((storage.insights_subscriptions as Stored).claude).toMatchObject({
      plan: "max5x",
      model: "Claude Opus 4.5",
    });
  });

  it("falls back to chat.openai.com when chatgpt.com returns a token-less session", async () => {
    // Keep claude + gemini fresh/skipped so only ChatGPT fetches.
    const storage: Stored = {
      insights_platform_usage_claude: { source: "provider", fetchedAt: 1_000_000 },
      insights_platform_usage_gemini: { source: "provider", fetchedAt: 1_000_000 },
      insights_subscriptions: { claude: { plan: "max5x", detectedAt: 1_000_000, manualOverride: false } },
    };
    installChromeStorage(storage);
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://chatgpt.com/api/auth/session") return Promise.resolve(makeJsonResponse({}));
      if (url === "https://chat.openai.com/api/auth/session") {
        return Promise.resolve(makeJsonResponse({ accessToken: "real-token", account: { planType: "plus" } }));
      }
      if (url === "https://chat.openai.com/backend-api/conversation/init") {
        expect((init?.headers as Record<string, string>)?.Authorization).toBe("Bearer real-token");
        return Promise.resolve(makeJsonResponse({ limits_progress: [{ feature_name: "research", remaining: 1, limit: 2 }], model_limits: [] }));
      }
      if (url === "https://chat.openai.com/backend-api/wham/usage") return Promise.resolve(makeJsonResponse({ credits: 3 }));
      throw new Error("unexpected fetch " + url);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await refreshProviderUsage("popup");

    expect(result.platforms?.chatgpt?.refreshed).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("https://chat.openai.com/api/auth/session", expect.any(Object));
    expect(storage.insights_platform_usage_chatgpt).toMatchObject({ limits: [{ feature: "research", remaining: 1, limit: 2 }] });
    expect((storage.insights_subscriptions as Stored).chatgpt).toMatchObject({ plan: "plus" });
  });

  it("does not wipe prior ChatGPT limits when conversation/init returns empty", async () => {
    const storage: Stored = {
      // Stale ChatGPT usage with known limits; claude + gemini fresh so only ChatGPT refreshes.
      insights_platform_usage_chatgpt: {
        source: "provider",
        chat: { limits: [{ feature: "research", remaining: 5 }], modelLimits: [{ model: "gpt-5", remaining: 9 }] },
        limits: [{ feature: "research", remaining: 5 }],
        modelLimits: [{ model: "gpt-5", remaining: 9 }],
        fetchedAt: 0,
      },
      insights_platform_usage_claude: { source: "provider", fetchedAt: 1_000_000 },
      insights_platform_usage_gemini: { source: "provider", fetchedAt: 1_000_000 },
      insights_subscriptions: {
        claude: { plan: "max5x", detectedAt: 1_000_000, manualOverride: false },
        chatgpt: { plan: "plus", detectedAt: 1_000_000, manualOverride: false },
      },
    };
    installChromeStorage(storage);
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://chatgpt.com/api/auth/session") return Promise.resolve(makeJsonResponse({ accessToken: "tok", account: { planType: "plus" } }));
      if (url === "https://chatgpt.com/backend-api/conversation/init") return Promise.resolve(makeJsonResponse({}));
      if (url === "https://chatgpt.com/backend-api/wham/usage") return Promise.resolve(makeJsonResponse({ credits: 4 }));
      throw new Error("unexpected fetch " + url);
    });
    vi.stubGlobal("fetch", fetchMock);

    await refreshProviderUsage("alarm");

    // Empty conversation/init must not clear the previously stored limits...
    expect(storage.insights_platform_usage_chatgpt).toMatchObject({
      limits: [{ feature: "research", remaining: 5 }],
      modelLimits: [{ model: "gpt-5", remaining: 9 }],
    });
    // ...but the Codex balance still updates.
    expect((storage.insights_platform_usage_chatgpt as Stored).codex).toBeDefined();
  });
});
