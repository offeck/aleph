import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";

// Runs inside `firebase emulators:exec` (npm run test:rules) — the emulator
// host comes from the environment the CLI sets up.

const OWNER = "owner-uid";
const STRANGER = "stranger-uid";
const DEVICE = "device-12345678";

let testEnv: RulesTestEnvironment;

function ownerDb() {
  return testEnv.authenticatedContext(OWNER).firestore();
}

function strangerDb() {
  return testEnv.authenticatedContext(STRANGER).firestore();
}

function anonDb() {
  return testEnv.unauthenticatedContext().firestore();
}

function rollup(deviceId: string, date: string) {
  return {
    schemaVersion: 2,
    deviceId,
    date,
    tzOffsetMinutes: -180,
    appVersion: "2.8.0",
    platforms: { claude: { totalSeconds: 60, hours: { "9": 60 } } },
  };
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-aleph-test",
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

describe("ownership", () => {
  it("denies every path to unauthenticated clients", async () => {
    const db = anonDb();
    await assertFails(getDoc(doc(db, `users/${OWNER}/usage/2026-06-10`)));
    await assertFails(setDoc(doc(db, `users/${OWNER}/usage/2026-06-10`), { claude: {} }));
    await assertFails(getDoc(doc(db, `users/${OWNER}/usageRollups/${DEVICE}_2026-06-10`)));
    await assertFails(setDoc(doc(db, `users/${OWNER}/usageRollups/${DEVICE}_2026-06-10`), rollup(DEVICE, "2026-06-10")));
    await assertFails(getDoc(doc(db, `users/${OWNER}/meta/settings2`)));
  });

  it("denies cross-user reads, writes, and list queries", async () => {
    const db = strangerDb();
    await assertFails(getDoc(doc(db, `users/${OWNER}/usage/2026-06-10`)));
    await assertFails(setDoc(doc(db, `users/${OWNER}/usage/2026-06-10`), { claude: {} }));
    await assertFails(setDoc(doc(db, `users/${OWNER}/usageRollups/${DEVICE}_2026-06-10`), rollup(DEVICE, "2026-06-10")));
    await assertFails(setDoc(doc(db, `users/${OWNER}/meta/subscriptions`), { claude: { plan: "pro" } }));
    await assertFails(getDocs(query(
      collection(db, `users/${OWNER}/usageRollups`),
      where("date", ">=", "2026-06-01"),
    )));
  });

  it("denies unknown collections and meta docs even to the owner", async () => {
    const db = ownerDb();
    await assertFails(setDoc(doc(db, `users/${OWNER}/junk/doc`), { x: 1 }));
    await assertFails(setDoc(doc(db, `users/${OWNER}/messageEvents/m1`), { x: 1 }));
    await assertFails(setDoc(doc(db, `users/${OWNER}/meta/other`), { x: 1 }));
    // The root user doc has no rule — denied.
    await assertFails(setDoc(doc(db, `users/${OWNER}`), { schemaVersion: 2 }));
  });
});

describe("legacy usage docs (old clients + migration seal)", () => {
  it("allows owner merge-style writes, reads, and deletes on date-keyed docs", async () => {
    const db = ownerDb();
    const ref = doc(db, `users/${OWNER}/usage/2026-06-10`);
    // Old-client shape: merge:true field-replace writes.
    await assertSucceeds(setDoc(ref, { claude: { totalSeconds: 60 }, _lastModified: 1 }, { merge: true }));
    await assertSucceeds(getDoc(ref));
    await assertSucceeds(deleteDoc(ref)); // 400-day retention sweep
  });

  it("rejects non-date document IDs", async () => {
    const db = ownerDb();
    await assertFails(setDoc(doc(db, `users/${OWNER}/usage/notadate`), { claude: {} }));
    await assertFails(setDoc(doc(db, `users/${OWNER}/usage/2026-6-1`), { claude: {} }));
  });
});

describe("usageRollups", () => {
  it("allows create/update when the ID matches deviceId_date, plus delete and range list", async () => {
    const db = ownerDb();
    const ref = doc(db, `users/${OWNER}/usageRollups/${DEVICE}_2026-06-10`);
    await assertSucceeds(setDoc(ref, rollup(DEVICE, "2026-06-10")));
    await assertSucceeds(setDoc(ref, rollup(DEVICE, "2026-06-10"))); // full-set rewrite
    await assertSucceeds(getDocs(query(
      collection(db, `users/${OWNER}/usageRollups`),
      where("date", ">=", "2026-06-01"),
    )));
    await assertSucceeds(deleteDoc(ref));
  });

  it("rejects rollups whose ID disagrees with their fields or with bad shapes", async () => {
    const db = ownerDb();
    // ID/date mismatch.
    await assertFails(setDoc(
      doc(db, `users/${OWNER}/usageRollups/${DEVICE}_2026-06-10`),
      rollup(DEVICE, "2026-06-11"),
    ));
    // ID/deviceId mismatch.
    await assertFails(setDoc(
      doc(db, `users/${OWNER}/usageRollups/${DEVICE}_2026-06-10`),
      rollup("device-99999999", "2026-06-10"),
    ));
    // Malformed date.
    await assertFails(setDoc(
      doc(db, `users/${OWNER}/usageRollups/${DEVICE}_notadate`),
      rollup(DEVICE, "notadate"),
    ));
    // Device IDs shorter than 8 chars.
    await assertFails(setDoc(
      doc(db, `users/${OWNER}/usageRollups/short_2026-06-10`),
      rollup("short", "2026-06-10"),
    ));
    // Missing identity fields entirely.
    await assertFails(setDoc(
      doc(db, `users/${OWNER}/usageRollups/${DEVICE}_2026-06-10`),
      { platforms: {} },
    ));
  });
});

describe("meta docs", () => {
  it("allows the three known docs, including the old-client flat settings shape", async () => {
    const db = ownerDb();
    // Old-client shape: flat settings keys merged at the doc root.
    await assertSucceeds(setDoc(doc(db, `users/${OWNER}/meta/settings`), { theme: "nord" }, { merge: true }));
    await assertSucceeds(setDoc(doc(db, `users/${OWNER}/meta/settings2`), {
      schemaVersion: 2,
      values: { theme: "nord" },
      updatedAtByKey: { theme: 123 },
    }));
    await assertSucceeds(setDoc(doc(db, `users/${OWNER}/meta/subscriptions`), {
      claude: { plan: "pro", detectedAt: 123, manualOverride: false },
    }, { merge: true }));
    await assertSucceeds(getDoc(doc(db, `users/${OWNER}/meta/settings2`)));
  });
});

describe("public config", () => {
  it("lets any client, even unauthenticated, read config docs", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "config/antigravity"), { secret: "svc-secret", version: 1 });
    });
    await assertSucceeds(getDoc(doc(anonDb(), "config/antigravity")));
    await assertSucceeds(getDoc(doc(strangerDb(), "config/antigravity")));
  });

  it("denies all client writes to config docs (admin SDK only)", async () => {
    await assertFails(setDoc(doc(anonDb(), "config/antigravity"), { secret: "x", version: 2 }));
    await assertFails(setDoc(doc(strangerDb(), "config/antigravity"), { secret: "x", version: 2 }));
    await assertFails(setDoc(doc(ownerDb(), "config/antigravity"), { secret: "x", version: 2 }));
  });
});
