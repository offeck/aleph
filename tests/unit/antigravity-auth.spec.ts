import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANTIGRAVITY_AUTH_KEY,
  ANTIGRAVITY_PKCE_KEY,
  buildConsentUrl,
  captureAntigravityCode,
  disconnectAntigravity,
  generatePkceVerifier,
  getAntigravityAccessToken,
  getAntigravityAuthStatus,
  pkceChallengeS256,
  startAntigravityConnect,
  _resetAntigravityAuthForTests,
} from "../../src/background/antigravityAuth";

type Stored = Record<string, unknown>;

function installChromeStorage(storage: Stored) {
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: vi.fn(async (defaults: Record<string, unknown>) => {
          const out: Stored = {};
          for (const [k, fb] of Object.entries(defaults)) out[k] = k in storage ? storage[k] : fb;
          return out;
        }),
        set: vi.fn(async (update: Stored) => { Object.assign(storage, update); }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const k of Array.isArray(keys) ? keys : [keys]) delete storage[k];
        }),
      },
    },
  });
}

function jsonResponse(data: unknown, ok = true): Response {
  return { ok, json: () => Promise.resolve(data) } as Response;
}

function base64Url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("antigravity PKCE + consent URL", () => {
  it("generates a unique base64url verifier of adequate length", () => {
    const v = generatePkceVerifier();
    expect(v).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(v.length).toBeGreaterThanOrEqual(43);
    expect(generatePkceVerifier()).not.toBe(v);
  });

  it("computes the RFC 7636 S256 challenge for a known verifier", async () => {
    const challenge = await pkceChallengeS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("builds a consent URL with PKCE, offline access, and the borrowed Antigravity client", async () => {
    const url = new URL(await buildConsentUrl("verifier-123"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const p = url.searchParams;
    expect(p.get("client_id")).toContain("1071006060591-");
    expect(p.get("response_type")).toBe("code");
    expect(p.get("redirect_uri")).toBe("http://localhost:51121/oauth-callback");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("code_challenge")).toBe(await pkceChallengeS256("verifier-123"));
    expect(p.get("access_type")).toBe("offline");
    expect(p.get("prompt")).toBe("consent");
    // fetchAvailableModels needs cclog + experimentsandconfigs, not just cloud-platform.
    expect(p.get("scope")).toContain("cloud-platform");
    expect(p.get("scope")).toContain("cclog");
    expect(p.get("scope")).toContain("experimentsandconfigs");
  });
});

describe("antigravity code exchange", () => {
  let storage: Stored;
  beforeEach(() => {
    storage = {};
    installChromeStorage(storage);
    _resetAntigravityAuthForTests();
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("stashes a verifier and returns the consent URL on connect", async () => {
    const { url } = await startAntigravityConnect();
    expect(storage[ANTIGRAVITY_PKCE_KEY]).toBeTruthy();
    expect(url).toContain("accounts.google.com/o/oauth2/v2/auth");
  });

  it("exchanges an auth code with the stashed verifier and persists the refresh token", async () => {
    storage[ANTIGRAVITY_PKCE_KEY] = "verifier-xyz";
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("code")).toBe("auth-code-1");
      expect(body.get("code_verifier")).toBe("verifier-xyz");
      expect(body.get("client_id")).toContain("1071006060591-");
      expect(body.get("client_secret")).toBeTruthy();
      expect(body.get("redirect_uri")).toBe("http://localhost:51121/oauth-callback");
      return jsonResponse({ refresh_token: "rt-1", access_token: "at-1", expires_in: 3600 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await captureAntigravityCode("auth-code-1");

    expect(result.success).toBe(true);
    const auth = storage[ANTIGRAVITY_AUTH_KEY] as Record<string, unknown>;
    expect(auth.refreshToken).toBe("rt-1");
    expect(auth.accessToken).toBe("at-1");
    expect(auth.expiresAt).toBe(1_000_000 + 3_600_000);
    expect(storage[ANTIGRAVITY_PKCE_KEY]).toBeUndefined();
  });

  it("decodes the account email from the id_token", async () => {
    storage[ANTIGRAVITY_PKCE_KEY] = "v";
    const idToken = "header." + base64Url({ email: "user@example.com" }) + ".sig";
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse({ refresh_token: "rt", access_token: "at", expires_in: 3600, id_token: idToken })));

    const result = await captureAntigravityCode("c");

    expect(result.email).toBe("user@example.com");
    expect((storage[ANTIGRAVITY_AUTH_KEY] as Record<string, unknown>).email).toBe("user@example.com");
  });

  it("returns an error and stores nothing on a rejected code", async () => {
    storage[ANTIGRAVITY_PKCE_KEY] = "v";
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse({ error: "invalid_grant", error_description: "Bad code" }, false)));

    const result = await captureAntigravityCode("bad");

    expect(result.success).toBe(false);
    expect(result.error).toContain("Bad code");
    expect(storage[ANTIGRAVITY_AUTH_KEY]).toBeUndefined();
  });

  it("fails fast without a network call when no verifier was stashed", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await captureAntigravityCode("c");

    expect(result.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("getAntigravityAccessToken", () => {
  let storage: Stored;
  beforeEach(() => {
    storage = {};
    installChromeStorage(storage);
    _resetAntigravityAuthForTests();
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("returns the stored access token without a network call when still fresh", async () => {
    storage[ANTIGRAVITY_AUTH_KEY] = { refreshToken: "rt", accessToken: "at-fresh", expiresAt: 1_000_000 + 600_000, email: null, connectedAt: 0 };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await getAntigravityAccessToken()).toBe("at-fresh");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes via grant_type=refresh_token when the stored token is expired", async () => {
    storage[ANTIGRAVITY_AUTH_KEY] = { refreshToken: "rt", accessToken: "at-old", expiresAt: 1_000_000 - 1, email: null, connectedAt: 0 };
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("refresh_token")).toBe("rt");
      return jsonResponse({ access_token: "at-new", expires_in: 3600 });
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(await getAntigravityAccessToken()).toBe("at-new");
    expect((storage[ANTIGRAVITY_AUTH_KEY] as Record<string, unknown>).accessToken).toBe("at-new");
  });

  it("clears stored auth and returns null when the refresh token is revoked", async () => {
    storage[ANTIGRAVITY_AUTH_KEY] = { refreshToken: "rt-bad", accessToken: null, expiresAt: null, email: null, connectedAt: 0 };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "invalid_grant" }, false)));

    expect(await getAntigravityAccessToken()).toBeNull();
    expect(storage[ANTIGRAVITY_AUTH_KEY]).toBeUndefined();
  });

  it("returns null without a network call when not connected", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await getAntigravityAccessToken()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("antigravity status + disconnect", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("round-trips connected status and clears it on disconnect", async () => {
    const storage: Stored = {};
    installChromeStorage(storage);
    _resetAntigravityAuthForTests();

    expect(await getAntigravityAuthStatus()).toEqual({ connected: false, configured: true });

    storage[ANTIGRAVITY_AUTH_KEY] = { refreshToken: "rt", accessToken: "at", expiresAt: 1, email: "u@e.com", connectedAt: 42 };
    expect(await getAntigravityAuthStatus()).toEqual({ connected: true, configured: true, email: "u@e.com", connectedAt: 42 });

    await disconnectAntigravity();
    expect(storage[ANTIGRAVITY_AUTH_KEY]).toBeUndefined();
    expect(await getAntigravityAuthStatus()).toEqual({ connected: false, configured: true });
  });
});
