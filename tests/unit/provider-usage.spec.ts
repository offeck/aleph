import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetProviderUsageRefreshStateForTests,
  chatgptAccountIdRaw,
  chatgptPlanTypeRaw,
  clearAntigravityUsage,
  detectAntigravityModelDrift,
  extractClaudeOrgId,
  inferGeminiPlanFromQuotas,
  normalizeClaudePlanFromOrg,
  parseGeminiSessionData,
  prepareProviderUsageSnapshot,
  refreshProviderUsage,
  shouldRefreshUsage,
} from "../../src/background/providerUsage";
import { ANTIGRAVITY_AUTH_KEY, ANTIGRAVITY_SECRET_KEY, _resetAntigravityAuthForTests } from "../../src/background/antigravityAuth";

// A fresh stored Antigravity access token — getAntigravityAccessToken returns it
// directly (no token-endpoint round-trip) while expiresAt is in the future. The
// user-entered client secret must also be present, or the whole path stays inert.
const ANTIGRAVITY_AUTH_FRESH = { refreshToken: "ag-refresh", accessToken: "ag-access", expiresAt: 9_999_999_999_999, email: "ag@example.com", connectedAt: 0 };

type Stored = Record<string, unknown>;

function makeJsonResponse(data: unknown) {
  return {
    ok: true,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(typeof data === "string" ? data : JSON.stringify(data)),
  } as Response;
}

function testJwt(payload: Record<string, unknown>): string {
  return "header." + btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") + ".sig";
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
  const remove = vi.fn(async (keys: string | string[]) => {
    for (const k of Array.isArray(keys) ? keys : [keys]) delete storage[k];
  });
  // chrome.storage.sync stub for any settings reads in the refresh path.
  const syncGet = vi.fn(async (defaults: Record<string, unknown>) => {
    const out: Stored = {};
    for (const [key, fallback] of Object.entries(defaults)) out[key] = key in storage ? storage[key] : fallback;
    return out;
  });
  const runtime = { lastError: undefined };
  vi.stubGlobal("chrome", {
    storage: { local: { get, set, remove }, sync: { get: syncGet } },
    cookies: {
      get: vi.fn((_details: chrome.cookies.CookieDetails, cb: (cookie: Partial<chrome.cookies.Cookie>) => void) => {
        cb({ value: "org-claude" });
      }),
    },
    runtime,
  });
  return { get, set };
}

function installProviderFetch(overrides: { antigravityModels?: unknown; onAntigravityFetch?: () => void } = {}) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://chatgpt.com/api/auth/session") {
      return Promise.resolve(makeJsonResponse({
        accessToken: "chat-token",
        account: { id: "acct-chat", planType: "plus" },
      }));
    }
    if (url === "https://chatgpt.com/backend-api/conversation/init") {
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>)?.Authorization).toBe("Bearer chat-token");
      expect((init?.headers as Record<string, string>)?.["ChatGPT-Account-Id"]).toBe("acct-chat");
      return Promise.resolve(makeJsonResponse({
        limits_progress: [{ feature_name: "deep_research", remaining: 8, limit: 10 }],
        model_limits: [{ model_slug: "gpt-5", remaining: 40, limit: 50 }],
      }));
    }
    if (url === "https://chatgpt.com/backend-api/wham/usage") {
      expect((init?.headers as Record<string, string>)?.Authorization).toBe("Bearer chat-token");
      expect((init?.headers as Record<string, string>)?.["ChatGPT-Account-Id"]).toBe("acct-chat");
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
    if (url === "https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist") {
      overrides.onAntigravityFetch?.();
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>)?.Authorization).toBe("Bearer ag-access");
      expect(String(init?.body)).toContain("ANTIGRAVITY");
      return Promise.resolve(makeJsonResponse({
        planInfo: { monthlyPromptCredits: 500, planType: "premium" },
        availablePromptCredits: 450,
        cloudaicompanionProject: { id: "ag-project" },
      }));
    }
    if (url === "https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels") {
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>)?.Authorization).toBe("Bearer ag-access");
      expect(String(init?.body)).toContain("ag-project");
      return Promise.resolve(makeJsonResponse(overrides.antigravityModels ?? {
        models: {
          "claude-sonnet-4-5": {
            displayName: "Claude Sonnet 4.5",
            quotaInfo: { remainingFraction: 0.4, resetTime: "2026-06-08T13:00:00.000Z" },
          },
        },
      }));
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

  it("preserves previous Gemini web and Antigravity fields across partial refreshes", () => {
    vi.setSystemTime(2_000_000);
    const previous = {
      source: "provider",
      credits: { limit: 100, remaining: 90, used: 10 },
      features: [{ id: 4, remaining: 90 }],
      mainChat: { limit: 100, remaining: 90 },
      activeModel: "gemini-3-pro",
      buildLabel: "boq_assistant-bard-web-server_20260608.01_p0",
      antigravity: {
        credits: { limit: 500, remaining: 450, used: 50 },
        models: [{ id: "claude-sonnet-4-5", remaining: 40 }],
      },
    };

    const next = prepareProviderUsageSnapshot("gemini", previous, {
      source: "provider",
      antigravity: {
        credits: { limit: 500, remaining: 400, used: 100 },
      },
    });

    expect(next.credits).toBe(previous.credits);
    expect(next.features).toBe(previous.features);
    expect(next.mainChat).toBe(previous.mainChat);
    expect(next.activeModel).toBe("gemini-3-pro");
    expect(next.buildLabel).toBe("boq_assistant-bard-web-server_20260608.01_p0");
    expect(next.antigravity).toMatchObject({
      credits: { limit: 500, remaining: 400, used: 100 },
      models: [{ id: "claude-sonnet-4-5", remaining: 40 }],
    });
    expect(next.metricValues).toMatchObject({
      "gemini:credits": 90,
      "gemini:feature:4": 90,
      "gemini:antigravity.credits": 400,
      "gemini:antigravity.model:claude-sonnet-4-5": 40,
    });
  });
});

describe("clearAntigravityUsage", () => {
  it("removes the antigravity block from the stored Gemini snapshot, keeping the rest", async () => {
    const storage: Stored = {
      insights_platform_usage_gemini: { source: "provider", credits: { limit: 100, remaining: 90 }, antigravity: { models: [{ id: "x" }] } },
    };
    installChromeStorage(storage);

    await clearAntigravityUsage();

    const snap = storage.insights_platform_usage_gemini as Stored;
    expect(snap.antigravity).toBeUndefined();
    expect(snap.credits).toMatchObject({ limit: 100, remaining: 90 });
  });

  it("is a no-op when there is no antigravity block or no snapshot", async () => {
    const storage: Stored = { insights_platform_usage_gemini: { source: "provider", credits: { limit: 100 } } };
    installChromeStorage(storage);
    await clearAntigravityUsage();
    expect((storage.insights_platform_usage_gemini as Stored).credits).toMatchObject({ limit: 100 });

    const empty: Stored = {};
    installChromeStorage(empty);
    await expect(clearAntigravityUsage()).resolves.toBeUndefined();
  });
});

describe("detectAntigravityModelDrift", () => {
  it("flags drift when the response carries models but none survive normalization", () => {
    expect(detectAntigravityModelDrift({ models: { a: {}, b: {}, c: {} } }, 0))
      .toEqual({ kind: "models-shape", sample: "raw=3 kept=0" });
  });

  it("stays silent when models normalize successfully", () => {
    expect(detectAntigravityModelDrift({ models: { a: {}, b: {} } }, 2)).toBeNull();
    expect(detectAntigravityModelDrift({ models: { a: {} } }, 1)).toBeNull();
  });

  it("stays silent when the response has no models (account simply not provisioned)", () => {
    expect(detectAntigravityModelDrift({ models: {} }, 0)).toBeNull();
    expect(detectAntigravityModelDrift({}, 0)).toBeNull();
    expect(detectAntigravityModelDrift(null, 0)).toBeNull();
    expect(detectAntigravityModelDrift(undefined, 0)).toBeNull();
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

describe("chatgptAccountIdRaw", () => {
  it("reads account ids from the session account and top-level fallback fields", () => {
    expect(chatgptAccountIdRaw({ account: { id: "acct-primary" } })).toBe("acct-primary");
    expect(chatgptAccountIdRaw({ account_id: "acct-top" })).toBe("acct-top");
    expect(chatgptAccountIdRaw({ chatgpt_account_id: "acct-chatgpt" })).toBe("acct-chatgpt");
  });

  it("falls back to the OpenAI auth claim inside the access token", () => {
    expect(chatgptAccountIdRaw({
      accessToken: testJwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acct-jwt" } }),
    })).toBe("acct-jwt");
  });

  it("returns null when no account id is present", () => {
    expect(chatgptAccountIdRaw({ account: { planType: "plus" } })).toBe(null);
    expect(chatgptAccountIdRaw({ accessToken: "not-a-jwt" })).toBe(null);
    expect(chatgptAccountIdRaw(null)).toBe(null);
  });
});

describe("refreshProviderUsage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    _resetProviderUsageRefreshStateForTests(() => 123456);
    _resetAntigravityAuthForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("fetches ChatGPT, Claude, and Gemini provider limits with nested Antigravity data", async () => {
    const storage: Stored = { [ANTIGRAVITY_AUTH_KEY]: ANTIGRAVITY_AUTH_FRESH, [ANTIGRAVITY_SECRET_KEY]: "test-secret" };
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
      antigravity: {
        credits: { limit: 500, remaining: 450, used: 50 },
        planType: "premium",
        project: "ag-project",
        models: [{ id: "claude-sonnet-4-5", remaining: 40, used: 60 }],
      },
    });
    expect(storage.insights_platform_usage_antigravity).toBeUndefined();
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

  it("leaves Antigravity inert (no Cloud Code fetch) when not connected", async () => {
    const storage: Stored = {}; // no stored antigravity auth → off by default
    installChromeStorage(storage);
    const fetchMock = installProviderFetch();

    await refreshProviderUsage();

    const gemini = storage.insights_platform_usage_gemini as Stored;
    expect(gemini.credits).toMatchObject({ limit: 100, remaining: 90 });
    expect(gemini.antigravity).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalledWith("https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist", expect.anything());
  });

  it("clears stale Antigravity meters when the account is gone (revoked/disconnected)", async () => {
    // A prior refresh stored Antigravity meters, but the account is no longer
    // connected (refresh token revoked → auth auto-cleared, or disconnected).
    // prepareProviderUsageSnapshot preserves `antigravity` across a missing
    // refresh, so without an explicit clear the stale meters would survive.
    const storage: Stored = {
      insights_platform_usage_gemini: {
        source: "provider",
        fetchedAt: 0,
        credits: { limit: 100, remaining: 50, used: 50 },
        antigravity: { source: "provider", credits: { limit: 500, remaining: 450, used: 50 }, models: [], planType: "premium", project: "ag" },
      },
      // no ANTIGRAVITY_AUTH_KEY → getAntigravityAccessToken returns null, not connected
    };
    installChromeStorage(storage);
    installProviderFetch();

    await refreshProviderUsage();

    const gemini = storage.insights_platform_usage_gemini as Stored;
    expect(gemini.antigravity).toBeUndefined();                          // stale meters dropped
    expect(gemini.credits).toMatchObject({ limit: 100, remaining: 90 }); // fresh Gemini web data kept
  });

  it("clears stale Antigravity meters even when the Gemini snapshot is fresh enough to throttle", async () => {
    const storage: Stored = {
      insights_platform_usage_gemini: {
        source: "provider",
        fetchedAt: 970_000,
        credits: { limit: 100, remaining: 50, used: 50 },
        antigravity: { source: "provider", credits: { limit: 500, remaining: 450, used: 50 }, models: [], planType: "premium", project: "ag" },
      },
      // no ANTIGRAVITY_AUTH_KEY -> inert/not connected
    };
    installChromeStorage(storage);
    const fetchMock = installProviderFetch();

    const result = await refreshProviderUsage();

    const gemini = storage.insights_platform_usage_gemini as Stored;
    expect(result.platforms?.gemini).toEqual({ refreshed: true });
    expect(gemini.antigravity).toBeUndefined();
    expect(gemini.credits).toMatchObject({ limit: 100, remaining: 50 });
    expect(fetchMock).not.toHaveBeenCalledWith("https://gemini.google.com/app", expect.any(Object));
    expect(fetchMock).not.toHaveBeenCalledWith("https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist", expect.any(Object));
  });

  it("discards in-flight Antigravity usage when the account disconnects mid-refresh", async () => {
    // The refresh obtained a token and its Cloud Code request is in flight when the
    // account is disconnected (auth removed). The response still carries usage, but
    // the write-time connection re-check must reject it so a just-completed
    // disconnect isn't clobbered by the older request.
    const storage: Stored = {
      [ANTIGRAVITY_AUTH_KEY]: ANTIGRAVITY_AUTH_FRESH,
      [ANTIGRAVITY_SECRET_KEY]: "test-secret",
      insights_platform_usage_gemini: {
        source: "provider",
        fetchedAt: 0,
        credits: { limit: 100, remaining: 50, used: 50 },
        antigravity: { source: "provider", credits: { limit: 500, remaining: 450, used: 50 }, models: [], planType: "premium", project: "ag" },
      },
    };
    installChromeStorage(storage);
    // The disconnect lands while the Cloud Code request is in flight.
    installProviderFetch({ onAntigravityFetch: () => { delete storage[ANTIGRAVITY_AUTH_KEY]; } });

    await refreshProviderUsage();

    const gemini = storage.insights_platform_usage_gemini as Stored;
    expect(gemini.antigravity).toBeUndefined();                          // in-flight usage rejected, stale cleared
    expect(gemini.credits).toMatchObject({ limit: 100, remaining: 90 }); // fresh Gemini web data still saved
  });

  it("writes Gemini web meters without waiting for the slow Antigravity fetch", async () => {
    // The Antigravity cloudcode calls (~1.5s) must not hold back the Gemini web
    // meters (~0.6s): the web snapshot has to land independently, before Antigravity
    // resolves, then Antigravity merges in afterward. Real timers so the fast web
    // fetch + its storage write settle while the gated Antigravity fetch hangs.
    vi.useRealTimers();
    const fresh = Date.now();
    let releaseAntigravity: () => void = () => {};
    const antigravityGate = new Promise<void>((resolve) => { releaseAntigravity = resolve; });
    const storage: Stored = {
      // Keep ChatGPT + Claude fresh so only Gemini fetches this run.
      insights_platform_usage_chatgpt: { source: "provider", fetchedAt: fresh },
      insights_platform_usage_claude: { source: "provider", fetchedAt: fresh },
      insights_subscriptions: {
        chatgpt: { plan: "plus", detectedAt: fresh, manualOverride: false },
        claude: { plan: "max5x", detectedAt: fresh, manualOverride: false },
      },
      [ANTIGRAVITY_AUTH_KEY]: ANTIGRAVITY_AUTH_FRESH,
      [ANTIGRAVITY_SECRET_KEY]: "test-secret",
    };
    installChromeStorage(storage);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://gemini.google.com/app") {
        return makeJsonResponse(`<script>WIZ_global_data={FdrFJe:"sid-123",SNlM0e:"at-token"}</script><script src="/_/mss/boq_assistant-bard-web-server_20260608.01_p0/main.js"></script>`);
      }
      if (url.startsWith("https://gemini.google.com/_/BardChatUi/data/batchexecute")) {
        const quotas = [[[null, 2, 0, [1780679819, 0], 100, 90]]];
        return makeJsonResponse(JSON.stringify([["wrb.fr", "qpEbW", JSON.stringify(quotas)]]));
      }
      if (url === "https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist") {
        await antigravityGate; // hang the whole Antigravity path until released
        return makeJsonResponse({ planInfo: { monthlyPromptCredits: 500, planType: "premium" }, availablePromptCredits: 450, cloudaicompanionProject: { id: "ag-project" } });
      }
      if (url === "https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels") {
        return makeJsonResponse({ models: { "claude-sonnet-4-5": { displayName: "Claude Sonnet 4.5", quotaInfo: { remainingFraction: 0.4, resetTime: "2026-06-08T13:00:00.000Z" } } } });
      }
      throw new Error("unexpected fetch " + url);
    });
    vi.stubGlobal("fetch", fetchMock);

    const refreshPromise = refreshProviderUsage();
    // Let the fast Gemini web fetch + write settle while Antigravity is still gated.
    await new Promise((r) => setTimeout(r, 30));

    const early = storage.insights_platform_usage_gemini as Stored;
    expect(early?.credits).toMatchObject({ limit: 100, remaining: 90 }); // web written independently
    expect(early?.antigravity).toBeUndefined();                          // Antigravity still in flight

    releaseAntigravity();
    await refreshPromise;

    const final = storage.insights_platform_usage_gemini as Stored;
    expect(final?.credits).toMatchObject({ limit: 100, remaining: 90 }); // web preserved
    expect(final?.antigravity).toMatchObject({ credits: { limit: 500, remaining: 450 } });
  });

  it("canary: records antigravity drift when fetchAvailableModels returns an unrecognized model shape", async () => {
    const storage: Stored = { [ANTIGRAVITY_AUTH_KEY]: ANTIGRAVITY_AUTH_FRESH, [ANTIGRAVITY_SECRET_KEY]: "test-secret" };
    installChromeStorage(storage);
    // A healthy 200 that carries model entries, but the quota shape changed
    // (quotaInfo → quotaShifted) so the normalizer keeps none — the silent failure.
    installProviderFetch({
      antigravityModels: { models: { "claude-sonnet-4-5": { displayName: "Claude Sonnet 4.5", quotaShifted: { remaining: 0.4 } } } },
    });

    await refreshProviderUsage();

    expect(storage.insights_contract_drift).toMatchObject({ antigravity: { kind: "models-shape", sample: "raw=1 kept=0" } });
    // Credits still parse from loadCodeAssist, but the model list is empty.
    const gemini = storage.insights_platform_usage_gemini as Stored;
    expect((gemini.antigravity as Stored)?.models).toEqual([]);
  });

  it("canary: does NOT record drift on a healthy antigravity response", async () => {
    const storage: Stored = { [ANTIGRAVITY_AUTH_KEY]: ANTIGRAVITY_AUTH_FRESH, [ANTIGRAVITY_SECRET_KEY]: "test-secret" };
    installChromeStorage(storage);
    installProviderFetch();

    await refreshProviderUsage();

    expect(storage.insights_contract_drift).toBeUndefined();
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

  it("force-refreshes past the freshness throttle (used right after an Antigravity connect)", async () => {
    const storage: Stored = {};
    installChromeStorage(storage);
    const fetchMock = installProviderFetch();

    await refreshProviderUsage();   // first fetch → snapshot now fresh
    fetchMock.mockClear();
    const result = await refreshProviderUsage("popup", true);   // force bypasses the throttle

    expect(result.refreshed).toBe(true);
    expect(result.platforms?.gemini?.refreshed).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("https://gemini.google.com/app", expect.any(Object));
  });

  it("a forced refresh does not reuse an in-flight non-forced refresh (post-connect race)", async () => {
    const storage: Stored = {};
    installChromeStorage(storage);
    const fetchMock = installProviderFetch();

    // The popup's opening (non-forced) refresh is still in flight when the
    // just-connected OAuth path fires its forced refresh. The forced one must run
    // its own fetch, not return the in-flight, token-less result.
    const opening = refreshProviderUsage();             // non-forced, now in-flight
    const forced = refreshProviderUsage("popup", true); // forced, arrives mid-flight
    const [, forcedResult] = await Promise.all([opening, forced]);

    expect(forcedResult.platforms?.gemini?.refreshed).toBe(true);
    const geminiAppCalls = fetchMock.mock.calls.filter(([url]) => url === "https://gemini.google.com/app").length;
    expect(geminiAppCalls).toBe(2); // opening fetched once; forced re-fetched instead of reusing it
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
