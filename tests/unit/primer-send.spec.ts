import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/background/usage", () => ({
  readLocal: vi.fn(() => Promise.resolve({})),
  writeLocal: vi.fn(() => Promise.resolve()),
  enqueueUsageWork: vi.fn((fn: () => Promise<unknown>) => fn()),
}));
const session = { origin: "https://chatgpt.com", token: "T", accountId: "A", plan: null };
vi.mock("../../src/background/providerUsage", () => ({
  fetchChatgptSession: vi.fn(() => Promise.resolve(session)),
  getClaudeOrgId: vi.fn(() => Promise.resolve("ORG")),
  fetchJson: vi.fn(() => Promise.resolve({})),
}));

import { sendCodexPrimer } from "../../src/background/primer";

function res(headers: Record<string, string>, status = 200) {
  return { ok: status < 400, status, headers: new Headers(headers), text: () => Promise.resolve("") };
}

describe("sendCodexPrimer", () => {
  afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

  it("POSTs the responses endpoint and records the reset from headers", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(res({ "x-codex-primary-reset-at": "1000", "x-codex-primary-used-percent": "2" })));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("chrome", { action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() } });

    const r = await sendCodexPrimer(() => 0);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://chatgpt.com/backend-api/codex/responses",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    expect(r.ok).toBe(true);
    expect(r.windowResetAt).toBe(1_000_000);
  });

  it("records signed-out when there is no token", async () => {
    const { fetchChatgptSession } = await import("../../src/background/providerUsage");
    (fetchChatgptSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ...session, token: null });
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("chrome", { action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() } });
    const r = await sendCodexPrimer(() => 0);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/signed out/i);
  });
});
