import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Orchestration tests for the alephSync singleton: fresh module per test via
// vi.resetModules(), chrome + firebase replaced with in-memory fakes. Fake
// timers keep the 60s push throttle inert (leading fires still run).

type AnyRecord = Record<string, any>;

function makeStorageArea(initial: AnyRecord = {}) {
  const data: AnyRecord = JSON.parse(JSON.stringify(initial));
  return {
    data,
    get: vi.fn(async (query: unknown) => {
      if (query == null) return { ...data };
      if (typeof query === "string") return query in data ? { [query]: data[query] } : {};
      if (Array.isArray(query)) {
        const out: AnyRecord = {};
        for (const k of query) if (k in data) out[k] = data[k];
        return out;
      }
      const out: AnyRecord = {};
      for (const [k, fallback] of Object.entries(query as AnyRecord)) {
        out[k] = k in data && data[k] !== undefined ? data[k] : fallback;
      }
      return out;
    }),
    set: vi.fn(async (entries: AnyRecord) => { Object.assign(data, JSON.parse(JSON.stringify(entries))); }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
    }),
  };
}

// Minimal compat-style Firestore fake: docs in a path-keyed map, snapshots
// with forEach/empty, batches that apply on commit, documentId range queries.
function makeFakeDb() {
  const docs = new Map<string, AnyRecord>();
  const failingGets = new Set<string>();

  function listChildren(colPath: string) {
    const out: Array<{ id: string; data: () => AnyRecord; ref: any }> = [];
    for (const [path, value] of docs) {
      if (!path.startsWith(colPath + "/")) continue;
      const id = path.slice(colPath.length + 1);
      if (id.includes("/")) continue;
      out.push({ id, data: () => JSON.parse(JSON.stringify(value)), ref: makeDocRef(path) });
    }
    return out;
  }

  function makeSnap(entries: ReturnType<typeof listChildren>) {
    return { empty: entries.length === 0, forEach: (fn: (d: unknown) => void) => entries.forEach(fn) };
  }

  function makeCol(colPath: string) {
    const assertReadable = () => {
      if (failingGets.has(colPath)) throw new Error("simulated read failure: " + colPath);
    };
    return {
      doc: (id: string) => makeDocRef(colPath + "/" + id),
      get: async () => { assertReadable(); return makeSnap(listChildren(colPath)); },
      limit: (n: number) => ({
        get: async () => { assertReadable(); return makeSnap(listChildren(colPath).slice(0, n)); },
      }),
      where: (field: unknown, op: string, value: string) => ({
        get: async () => {
          assertReadable();
          const entries = listChildren(colPath).filter((d) => {
            const probe = field === "__name__" ? d.id : d.data()[String(field)];
            return op === ">=" ? String(probe) >= value : true;
          });
          return makeSnap(entries);
        },
      }),
    };
  }

  function makeDocRef(path: string): any {
    return {
      _path: path,
      collection: (name: string) => makeCol(path + "/" + name),
      get: async () => ({
        exists: docs.has(path),
        id: path.split("/").pop(),
        data: () => (docs.has(path) ? JSON.parse(JSON.stringify(docs.get(path))) : undefined),
      }),
      set: async (data: AnyRecord, opts?: { merge?: boolean }) => applySet(path, data, opts),
    };
  }

  // The real SDK rejects explicit-undefined field values — the fake must too,
  // or it masks exactly the failure class that broke the production seal.
  function assertNoUndefined(value: unknown, fieldPath: string) {
    if (value === undefined) throw new Error("Unsupported field value: undefined (found in field " + fieldPath + ")");
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) assertNoUndefined(v, fieldPath + "." + k);
    }
  }

  function applySet(path: string, data: AnyRecord, opts?: { merge?: boolean }) {
    assertNoUndefined(data, path);
    const clean = JSON.parse(JSON.stringify(data));
    if (opts?.merge && docs.has(path)) docs.set(path, { ...docs.get(path), ...clean });
    else docs.set(path, clean);
  }

  return {
    docs,
    failingGets,
    collection: (name: string) => makeCol(name),
    batch: () => {
      const ops: Array<() => void> = [];
      return {
        set: (ref: any, data: AnyRecord, opts?: { merge?: boolean }) => ops.push(() => applySet(ref._path, data, opts)),
        delete: (ref: any) => ops.push(() => docs.delete(ref._path)),
        commit: async () => { for (const op of ops) op(); },
      };
    },
  };
}

interface Env {
  local: ReturnType<typeof makeStorageArea>;
  syncArea: ReturnType<typeof makeStorageArea>;
  db: ReturnType<typeof makeFakeDb>;
  auth: { signInWithCredential: ReturnType<typeof vi.fn>; signOut: ReturnType<typeof vi.fn> };
  removeCachedAuthToken: ReturnType<typeof vi.fn>;
  getAuthToken: ReturnType<typeof vi.fn>;
}

function setupEnv(opts: {
  local?: AnyRecord;
  syncData?: AnyRecord;
  tokens?: Array<string | Error>;
} = {}): Env {
  const local = makeStorageArea(opts.local);
  const syncArea = makeStorageArea(opts.syncData);
  const db = makeFakeDb();
  const auth = {
    signInWithCredential: vi.fn(async () => ({ user: { uid: "user-1", email: "user@example.com" } })),
    signOut: vi.fn(async () => {}),
  };
  const removeCachedAuthToken = vi.fn(async () => {});
  const tokens = opts.tokens ?? ["tok-1"];
  const runtime: AnyRecord = { lastError: undefined, getManifest: () => ({ version: "2.8.0" }) };
  const getAuthToken = vi.fn((_opts: unknown, cb: (t?: string) => void) => {
    const next = tokens.length > 1 ? tokens.shift() : tokens[0];
    if (next instanceof Error) {
      runtime.lastError = { message: next.message };
      cb(undefined);
      runtime.lastError = undefined;
    } else {
      cb(next);
    }
  });

  vi.stubGlobal("chrome", {
    storage: { local, sync: syncArea },
    identity: { getAuthToken, removeCachedAuthToken },
    runtime,
  });
  vi.stubGlobal("firebase", {
    auth: { GoogleAuthProvider: { credential: vi.fn(() => ({})) } },
    firestore: {
      FieldValue: { serverTimestamp: () => ({ __serverTs: true }) },
      FieldPath: { documentId: () => "__name__" },
    },
  });
  vi.stubGlobal("crypto", { randomUUID: () => "11111111-2222-3333-4444-555555555555" });

  return { local, syncArea, db, auth, removeCachedAuthToken, getAuthToken };
}

async function importSync(env: Env) {
  const mod = await import("../../src/background/sync");
  mod.alephSync.init({ auth: () => env.auth, firestore: () => env.db });
  return mod.alephSync;
}

// Storage/db fakes resolve in microtasks only — pumping them settles every
// fire-and-forget chain without advancing the (faked) timers.
async function pump(times = 60) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

const SIGNED_IN = { signedIn: true, uid: "user-1", email: "user@example.com", lastSyncAt: null, token: "tok-old" };

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("restoreAuth", () => {
  it("is single-flight and refreshes the stored identity token", async () => {
    const env = setupEnv({ local: { aleph_sync_auth: SIGNED_IN }, tokens: ["tok-fresh"] });
    const sync = await importSync(env);

    await Promise.all([sync.restoreAuth(), sync.restoreAuth()]);

    expect(env.auth.signInWithCredential).toHaveBeenCalledTimes(1);
    expect(env.local.data.aleph_sync_auth.token).toBe("tok-fresh");
    expect(env.local.data.aleph_sync_auth.signedIn).toBe(true);
  });

  it("keeps the stored auth state on transient failures (offline boot)", async () => {
    const env = setupEnv({
      local: { aleph_sync_auth: SIGNED_IN },
      tokens: [new Error("network down"), new Error("network down")],
    });
    const sync = await importSync(env);

    await sync.restoreAuth();

    expect(env.auth.signInWithCredential).not.toHaveBeenCalled();
    expect(env.local.data.aleph_sync_auth).toEqual(SIGNED_IN);
  });

  it("retries on a later call after a transient failure (no permanent memo)", async () => {
    const env = setupEnv({
      local: { aleph_sync_auth: SIGNED_IN },
      tokens: [new Error("offline"), new Error("offline"), "tok-good"],
    });
    const sync = await importSync(env);

    await sync.restoreAuth(); // both attempts fail — worker must not be pinned
    expect(env.auth.signInWithCredential).not.toHaveBeenCalled();

    await sync.restoreAuth(); // e.g. the 20-min alarm flush — must retry
    expect(env.auth.signInWithCredential).toHaveBeenCalledTimes(1);
    expect(env.local.data.aleph_sync_auth.token).toBe("tok-good");
  });

  it("clears the cached token and retries once; signs out only on an auth/ rejection", async () => {
    const env = setupEnv({ local: { aleph_sync_auth: SIGNED_IN }, tokens: ["tok-stale", "tok-stale2"] });
    env.auth.signInWithCredential.mockRejectedValue(Object.assign(new Error("bad"), { code: "auth/invalid-credential" }));
    const sync = await importSync(env);

    await sync.restoreAuth();

    expect(env.removeCachedAuthToken).toHaveBeenCalledWith({ token: "tok-stale" });
    expect(env.auth.signInWithCredential).toHaveBeenCalledTimes(2);
    expect(env.local.data.aleph_sync_auth).toBeUndefined();
  });

  it("recovers when the cleared-token retry succeeds", async () => {
    const env = setupEnv({ local: { aleph_sync_auth: SIGNED_IN }, tokens: ["tok-stale", "tok-good"] });
    env.auth.signInWithCredential
      .mockRejectedValueOnce(Object.assign(new Error("expired"), { code: "auth/invalid-credential" }))
      .mockResolvedValueOnce({ user: { uid: "user-1", email: "user@example.com" } });
    const sync = await importSync(env);

    await sync.restoreAuth();

    expect(env.local.data.aleph_sync_auth.token).toBe("tok-good");
    expect(env.local.data.aleph_sync_auth.signedIn).toBe(true);
  });
});

describe("sign-in / sign-out", () => {
  it("stores the token at sign-in; sign-out revokes it and clears sync caches but keeps identity flags", async () => {
    const env = setupEnv({
      local: {
        aleph_device_id: "dev-keep",
        aleph_sync_adopted: true,
        aleph_settings_meta: { theme: 5 },
        aleph_remote_usage: { "2026-06-01": {} },
        aleph_sync_dirty: ["usage_2026-06-01"],
        aleph_sync_echo: { theme: "nord" },
        aleph_sync_queue: [{ key: "old" }],
      },
      syncData: { theme: "nord" }, // the stamped key has a real value
      tokens: ["tok-interactive"],
    });
    const sync = await importSync(env);

    const signedIn = await sync.signIn();
    expect(signedIn.success).toBe(true);
    expect(env.local.data.aleph_sync_auth.token).toBe("tok-interactive");
    await pump();

    const signedOut = await sync.signOut();
    expect(signedOut.success).toBe(true);
    expect(env.removeCachedAuthToken).toHaveBeenCalledWith({ token: "tok-interactive" });
    expect(env.local.data.aleph_sync_auth).toBeUndefined();
    expect(env.local.data.aleph_sync_dirty).toBeUndefined();
    expect(env.local.data.aleph_sync_echo).toBeUndefined();
    expect(env.local.data.aleph_remote_usage).toBeUndefined();
    expect(env.local.data.aleph_sync_queue).toBeUndefined();
    expect(env.local.data.aleph_device_id).toBe("dev-keep");
    expect(env.local.data.aleph_sync_adopted).toBe(true);
    expect(env.local.data.aleph_settings_meta).toEqual({ theme: 5 });
  });
});

describe("dirty flush", () => {
  it("pushes the CURRENT local value at flush time and clears the key", async () => {
    const env = setupEnv({
      local: {
        aleph_sync_auth: SIGNED_IN,
        aleph_sync_adopted: true,
        aleph_device_id: "dev-aaaaaaaa",
        aleph_sync_dirty: ["usage_2026-06-10"],
        "usage_2026-06-10": { claude: { totalSeconds: 5, messageCount: 1 } },
      },
    });
    const sync = await importSync(env);

    await sync.restoreAuth();
    // The doc changes AFTER the key went dirty — the push must read this.
    env.local.data["usage_2026-06-10"] = { claude: { totalSeconds: 99, messageCount: 7 } };
    await sync.flushDirty();

    const doc = env.db.docs.get("users/user-1/usageRollups/dev-aaaaaaaa_2026-06-10");
    expect(doc?.platforms.claude.totalSeconds).toBe(99);
    expect(doc?.platforms.claude.messageCount).toBe(7);
    expect(doc?.deviceId).toBe("dev-aaaaaaaa");
    expect(doc?.date).toBe("2026-06-10");
    expect(env.local.data.aleph_sync_dirty).toEqual([]);
    // The pre-v2 value queue is removed at flush.
    expect(env.local.data.aleph_sync_queue).toBeUndefined();
  });

  it("never uploads rollups before adoption — the key stays dirty", async () => {
    const env = setupEnv({
      local: {
        aleph_sync_auth: SIGNED_IN,
        aleph_sync_dirty: ["usage_2026-06-10"],
        "usage_2026-06-10": { claude: { totalSeconds: 5 } },
      },
    });
    // Legacy probe fails → adoption cannot settle → pushes must hold.
    env.db.failingGets.add("users/user-1/usage");
    const sync = await importSync(env);

    await sync.restoreAuth();
    await sync.ensureMigrated();
    await sync.flushDirty();

    expect([...env.db.docs.keys()].filter((p) => p.includes("usageRollups"))).toEqual([]);
    expect(env.local.data.aleph_sync_dirty).toEqual(["usage_2026-06-10"]);
  });
});

describe("settings echo guard", () => {
  it("consumes a guarded echo one-shot without restamping; real changes are stamped", async () => {
    const env = setupEnv({
      local: { aleph_sync_echo: { theme: "nord" } },
    });
    const sync = await importSync(env);

    sync.onSettingsChanged({ theme: { newValue: "nord", oldValue: "none" } } as never);
    await pump();
    expect(env.local.data.aleph_settings_meta).toBeUndefined(); // echo: no stamp
    expect(env.local.data.aleph_sync_echo).toEqual({}); // consumed

    sync.onSettingsChanged({ theme: { newValue: "nord", oldValue: "none" } } as never);
    await pump();
    expect(env.local.data.aleph_settings_meta?.theme).toBeGreaterThan(0); // real change now
  });

  it("applies remote winners locally with a persisted guard and pushes the merged doc", async () => {
    const env = setupEnv({
      local: {
        aleph_sync_auth: SIGNED_IN,
        aleph_sync_adopted: true,
        aleph_device_id: "dev-aaaaaaaa",
        aleph_settings_meta: { fontSize: 50 },
        aleph_sync_dirty: ["aleph_settings"],
      },
      syncData: { theme: "none", fontSize: 14 },
    });
    env.db.docs.set("users/user-1/meta/settings2", {
      schemaVersion: 2,
      values: { theme: "dracula", fontSize: 12 },
      updatedAtByKey: { theme: 100, fontSize: 10 },
    });
    const sync = await importSync(env);

    await sync.restoreAuth();
    await sync.flushDirty();

    // Remote theme (stamped 100) beats unstamped local; local fontSize (50) beats remote (10).
    expect(env.syncArea.data.theme).toBe("dracula");
    expect(env.syncArea.data.fontSize).toBe(14);
    expect(env.local.data.aleph_sync_echo).toEqual({ theme: "dracula" }); // guard written for the apply
    const pushed = env.db.docs.get("users/user-1/meta/settings2");
    expect(pushed?.values).toEqual({ theme: "dracula", fontSize: 14 });
    expect(pushed?.updatedAtByKey).toEqual({ theme: 100, fontSize: 50 });
    expect(env.local.data.aleph_settings_meta).toEqual({ theme: 100, fontSize: 50 });
  });
});

describe("migration / adoption", () => {
  it("seal-and-adopt: seals the union to legacy, seeds the cache, resets local docs, sets flags", async () => {
    const env = setupEnv({
      local: {
        aleph_sync_auth: SIGNED_IN,
        "usage_2026-06-09": { claude: { totalSeconds: 120, messageCount: 3 } },
        "usage_2026-06-10": { claude: { totalSeconds: 50, messageCount: 2 } },
      },
    });
    env.db.docs.set("users/user-1/usage/2026-06-09", {
      claude: { totalSeconds: 90, messageCount: 5 },
      _lastModified: { __serverTs: true },
    });
    const sync = await importSync(env);

    await sync.restoreAuth();
    await sync.ensureMigrated();

    // Cloud legacy holds the max-merged union (never less than either side).
    const sealed = env.db.docs.get("users/user-1/usage/2026-06-09");
    expect(sealed?.claude.totalSeconds).toBe(120);
    expect(sealed?.claude.messageCount).toBe(5);
    // Cache seeded from the union; local docs reset to own-only.
    expect(env.local.data.aleph_remote_usage["2026-06-09"].claude.totalSeconds).toBe(120);
    expect(env.local.data.aleph_remote_usage["2026-06-10"].claude.totalSeconds).toBe(50);
    expect(env.local.data["usage_2026-06-09"]).toEqual({});
    expect(env.local.data["usage_2026-06-10"]).toEqual({});
    expect(env.local.data.aleph_sync_adopted).toBe(true);
    expect(env.local.data.aleph_sync_schema).toBe(2);
  });

  it("is exact under a racing usage update (queue serialization, no double count)", async () => {
    const env = setupEnv({
      local: {
        aleph_sync_auth: SIGNED_IN,
        "usage_2026-06-10": { claude: { totalSeconds: 50 } },
      },
    });
    env.db.docs.set("users/user-1/usage/2026-06-10", { claude: { totalSeconds: 40 } });
    vi.setSystemTime(new Date(2026, 5, 10, 12, 0, 0)); // todayKey() → usage_2026-06-10
    const env2 = env;
    const sync = await importSync(env2);
    const usage = await import("../../src/background/usage");

    await sync.restoreAuth();
    const migration = sync.ensureMigrated();
    // A tracker message lands mid-migration — must serialize, never interleave.
    const update = usage.updateUsageDay((day) => {
      const claude = usage.ensurePlatformDay(day, "claude");
      claude.messageCount += 1;
    });
    await Promise.all([migration, update]);
    await pump();

    // Whatever the interleaving, displayed total = own + cache exactly once.
    const combined = await usage.readCombinedUsageDays(["usage_2026-06-10"]);
    expect(combined["usage_2026-06-10"]?.claude.totalSeconds).toBe(50);
    expect(combined["usage_2026-06-10"]?.claude.messageCount).toBe(1);
    expect(env.local.data.aleph_sync_adopted).toBe(true);
  });

  it("a second boot after a successful seal is a no-op (idempotent)", async () => {
    const env = setupEnv({
      local: {
        aleph_sync_auth: SIGNED_IN,
        "usage_2026-06-09": { claude: { totalSeconds: 120 } },
      },
    });
    let sync = await importSync(env);
    await sync.restoreAuth();
    await sync.ensureMigrated();
    const cloudAfterSeal = JSON.stringify([...env.db.docs.entries()]);
    const localAfterSeal = JSON.stringify(env.local.data);

    // Next worker boot: fresh module instance, same storage and cloud.
    vi.resetModules();
    sync = await importSync(env);
    await sync.restoreAuth();
    await sync.ensureMigrated();

    expect(JSON.stringify([...env.db.docs.entries()])).toBe(cloudAfterSeal);
    expect(JSON.stringify(env.local.data)).toBe(localAfterSeal);
  });

  it("migrates within the same worker once auth recovers (alarm self-heal)", async () => {
    const env = setupEnv({
      local: {
        aleph_sync_auth: SIGNED_IN,
        "usage_2026-06-09": { claude: { totalSeconds: 120 } },
      },
      tokens: [new Error("offline"), new Error("offline"), "tok-good"],
    });
    env.db.docs.set("users/user-1/usage/2026-06-09", { claude: { totalSeconds: 90 } });
    const sync = await importSync(env);

    // Boot: restore fails transiently → migration runs without auth (no seal).
    await sync.restoreAuth();
    await sync.ensureMigrated();
    expect(env.local.data.aleph_sync_adopted).toBeUndefined();

    // Next readiness check (alarm flush): restore succeeds → migration re-runs.
    await sync.restoreAuth();
    await sync.ensureMigrated();
    expect(env.local.data.aleph_sync_adopted).toBe(true);
    expect(env.local.data["usage_2026-06-09"]).toEqual({});
    expect(env.local.data.aleph_remote_usage["2026-06-09"].claude.totalSeconds).toBe(120);
  });

  it("adopt-fresh: empty cloud keeps local history as this device's own", async () => {
    const env = setupEnv({
      local: {
        aleph_sync_auth: SIGNED_IN,
        "usage_2026-06-10": { claude: { totalSeconds: 50 } },
      },
    });
    const sync = await importSync(env);

    await sync.restoreAuth();
    await sync.ensureMigrated();

    expect(env.local.data.aleph_sync_adopted).toBe(true);
    expect(env.local.data["usage_2026-06-10"]).toEqual({ claude: { totalSeconds: 50 } }); // NOT reset
    expect(env.local.data.aleph_remote_usage).toBeUndefined(); // nothing sealed
  });
});

describe("pull", () => {
  it("lightweightPull builds the remote cache from other devices' rollups ADD the legacy baseline", async () => {
    vi.setSystemTime(new Date(2026, 5, 10, 12, 0, 0));
    const env = setupEnv({
      local: {
        aleph_sync_auth: SIGNED_IN,
        aleph_sync_adopted: true,
        aleph_device_id: "dev-aaaaaaaa",
      },
    });
    env.db.docs.set("users/user-1/usage/2026-06-09", { claude: { totalSeconds: 100 } });
    env.db.docs.set("users/user-1/usageRollups/dev-aaaaaaaa_2026-06-09", {
      deviceId: "dev-aaaaaaaa", date: "2026-06-09", platforms: { claude: { totalSeconds: 999 } },
    });
    env.db.docs.set("users/user-1/usageRollups/dev-bbbbbbbb_2026-06-09", {
      deviceId: "dev-bbbbbbbb", date: "2026-06-09", platforms: { claude: { totalSeconds: 30, messageCount: 2 } },
    });
    const sync = await importSync(env);

    await sync.restoreAuth();
    await sync.lightweightPull();

    const cached = env.local.data.aleph_remote_usage["2026-06-09"];
    expect(cached.claude.totalSeconds).toBe(130); // legacy 100 + other device 30; own 999 excluded
    expect(cached.claude.messageCount).toBe(2);
  });

  it("fullMergeAndSync pushes every local day as rollups and applies 400-day retention", async () => {
    vi.setSystemTime(new Date(2026, 5, 10, 12, 0, 0));
    const env = setupEnv({
      local: {
        aleph_sync_auth: SIGNED_IN,
        aleph_sync_adopted: true,
        aleph_device_id: "dev-aaaaaaaa",
        "usage_2026-06-09": { claude: { totalSeconds: 10 } },
        "usage_2026-06-10": { claude: { totalSeconds: 20 } },
      },
    });
    // Ancient docs past the 400-day retention window.
    env.db.docs.set("users/user-1/usage/2024-01-01", { claude: { totalSeconds: 1 } });
    env.db.docs.set("users/user-1/usageRollups/dev-bbbbbbbb_2024-01-01", {
      deviceId: "dev-bbbbbbbb", date: "2024-01-01", platforms: { claude: { totalSeconds: 1 } },
    });
    const sync = await importSync(env);

    await sync.restoreAuth();
    await sync.fullMergeAndSync();

    expect(env.db.docs.get("users/user-1/usageRollups/dev-aaaaaaaa_2026-06-09")?.platforms.claude.totalSeconds).toBe(10);
    expect(env.db.docs.get("users/user-1/usageRollups/dev-aaaaaaaa_2026-06-10")?.platforms.claude.totalSeconds).toBe(20);
    expect(env.db.docs.has("users/user-1/usage/2024-01-01")).toBe(false);
    expect(env.db.docs.has("users/user-1/usageRollups/dev-bbbbbbbb_2024-01-01")).toBe(false);
  });
});
