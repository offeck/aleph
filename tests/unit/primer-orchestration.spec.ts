import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/background/usage", () => ({
  readLocal: vi.fn(() => Promise.resolve({})),
  writeLocal: vi.fn(() => Promise.resolve()),
  enqueueUsageWork: vi.fn((fn: () => Promise<unknown>) => fn()),
}));
vi.mock("../../src/background/providerUsage", () => ({
  fetchChatgptSession: vi.fn(() => Promise.resolve({ origin: "https://chatgpt.com", token: "T", accountId: "A", plan: null })),
  getClaudeOrgId: vi.fn(() => Promise.resolve("ORG")),
  fetchJson: vi.fn(() => Promise.resolve({})),
}));

import * as primer from "../../src/background/primer";
import { fetchJson } from "../../src/background/providerUsage";

const settings = {
  primerEnabled: true, primerMode: "scheduled", primerTimes: ["08:00"],
  primerOffDays: [], primerActiveHoursEnabled: false, primerActiveStart: "07:00", primerActiveEnd: "23:00",
  primerTargetClaude: false, primerTargetCodex: true,
  primerAutoDeleteClaude: true, primerJitterEnabled: false, primerJitterSeconds: 0,
};

function chromeStub(getAllReturn: Array<{ name: string }> = []) {
  const created: Array<{ name: string; when: number }> = [];
  const cleared: string[] = [];
  vi.stubGlobal("chrome", {
    action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
    storage: { sync: { get: (_d: unknown, cb: (s: Record<string, unknown>) => void) => cb(settings) } },
    alarms: {
      getAll: (cb: (a: Array<{ name: string }>) => void) => cb(getAllReturn),
      create: vi.fn((name: string, opts: { when: number }) => created.push({ name, when: opts.when })),
      clear: vi.fn((name: string) => cleared.push(name)),
    },
  });
  return { created, cleared };
}

describe("reconcilePrimerAlarms", () => {
  afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });
  it("clears stale primer alarms and creates the desired set (leaves non-primer alarms)", async () => {
    const { created, cleared } = chromeStub([{ name: "aleph-primer-sched-99:99" }, { name: "aleph-refresh-limits" }]);
    await primer.reconcilePrimerAlarms();
    expect(cleared).toContain("aleph-primer-sched-99:99");
    expect(cleared).not.toContain("aleph-refresh-limits");
    expect(created.map((c) => c.name)).toEqual(["aleph-primer-sched-08:00"]);
  });
});

describe("runPrimer skip-if-active", () => {
  afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });
  it("skips the send when the window is already active", async () => {
    chromeStub();
    // wham/usage read (mocked providerUsage.fetchJson) reports a live window.
    (fetchJson as ReturnType<typeof vi.fn>).mockResolvedValue({ primary: { reset_after_seconds: 3600 } });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const r = await primer.runPrimer("codex");
    expect(fetchMock).not.toHaveBeenCalled();  // no responses POST — send was skipped
    expect(r.reason).toMatch(/already active/i);
  });
});
