import { afterEach, describe, expect, it, vi } from "vitest";

const store: Record<string, unknown> = {};
vi.mock("../../src/background/usage", () => ({
  readLocal: vi.fn((k: string, fb: unknown) => Promise.resolve(k in store ? store[k] : fb)),
  writeLocal: vi.fn((k: string, v: unknown) => { store[k] = v; return Promise.resolve(); }),
  enqueueUsageWork: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

import { recordPrimerResult, getPrimerStatus, PRIMER_STATUS_KEY } from "../../src/background/primer";

describe("primer status store", () => {
  afterEach(() => { for (const k of Object.keys(store)) delete store[k]; vi.clearAllMocks(); });

  it("records per-target results and reads them back", async () => {
    vi.stubGlobal("chrome", { action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() } });
    await recordPrimerResult("codex", { at: 1, ok: true, windowResetAt: 999 });
    await recordPrimerResult("claude", { at: 2, ok: false, reason: "signed out" });
    const s = await getPrimerStatus();
    expect(s.codex.ok).toBe(true);
    expect(s.claude.reason).toBe("signed out");
    expect(store[PRIMER_STATUS_KEY]).toBeTruthy();
  });

  it("raises a failure badge on a failed result and clears it on read", async () => {
    const setBadgeText = vi.fn();
    vi.stubGlobal("chrome", { action: { setBadgeText, setBadgeBackgroundColor: vi.fn() } });
    await recordPrimerResult("claude", { at: 2, ok: false, reason: "401" });
    expect(setBadgeText).toHaveBeenCalledWith({ text: "!" });
    setBadgeText.mockClear();
    await getPrimerStatus();
    expect(setBadgeText).toHaveBeenCalledWith({ text: "" });
  });
});
