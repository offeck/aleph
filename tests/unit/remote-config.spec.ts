import { afterEach, describe, expect, it, vi } from "vitest";
import { getAntigravityClientSecret } from "../../src/background/remoteConfig";

// Stub the firebase compat global with a fake firestore returning one doc.
function stubFirebase(docData: unknown, exists = true) {
  const get = vi.fn(async () => ({ exists, data: () => docData }));
  const docFn = vi.fn((_path: string) => ({ get }));
  vi.stubGlobal("firebase", { apps: [{}], firestore: () => ({ doc: docFn }) });
  return { get, docFn };
}

describe("getAntigravityClientSecret", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns null when the firebase global is undefined (dev / non-worker)", async () => {
    expect(await getAntigravityClientSecret()).toBeNull();
  });

  it("returns null when firebase has no initialized app (PLACEHOLDER config)", async () => {
    vi.stubGlobal("firebase", { apps: [], firestore: vi.fn() });
    expect(await getAntigravityClientSecret()).toBeNull();
  });

  it("reads the secret from config/antigravity", async () => {
    const { docFn } = stubFirebase({ secret: "svc-secret", version: 3 });
    expect(await getAntigravityClientSecret()).toBe("svc-secret");
    expect(docFn).toHaveBeenCalledWith("config/antigravity");
  });

  it("trims the secret and ignores the version metadata", async () => {
    stubFirebase({ secret: "  spaced  " });
    expect(await getAntigravityClientSecret()).toBe("spaced");
  });

  it("returns null when the doc does not exist", async () => {
    stubFirebase({}, false);
    expect(await getAntigravityClientSecret()).toBeNull();
  });

  it("returns null when the secret field is absent or empty", async () => {
    stubFirebase({ version: 1 });
    expect(await getAntigravityClientSecret()).toBeNull();
    stubFirebase({ secret: "   ", version: 1 });
    expect(await getAntigravityClientSecret()).toBeNull();
  });

  it("never throws — returns null on a firestore read error", async () => {
    const get = vi.fn(async () => { throw new Error("network"); });
    vi.stubGlobal("firebase", { apps: [{}], firestore: () => ({ doc: () => ({ get }) }) });
    expect(await getAntigravityClientSecret()).toBeNull();
  });
});
