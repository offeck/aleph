import { describe, expect, it } from "vitest";
import {
  PRIMER_GREETINGS, pickGreeting, isOffDay, withinActiveHours, applyJitter,
  nextScheduledOccurrence, nextSmartFire, desiredPrimerAlarmNames, computeAlarmWhen,
} from "../../src/background/primerSchedule";

describe("pickGreeting", () => {
  it("returns a roster member for any rng in [0,1)", () => {
    expect(PRIMER_GREETINGS).toContain(pickGreeting(() => 0));
    expect(PRIMER_GREETINGS).toContain(pickGreeting(() => 0.999999));
    expect(pickGreeting(() => 0)).toBe(PRIMER_GREETINGS[0]);
  });
});

describe("isOffDay", () => {
  it("matches JS getDay values", () => {
    const sun = new Date(2026, 6, 12); // Sunday
    expect(isOffDay(sun, [0])).toBe(true);
    expect(isOffDay(sun, [5, 6])).toBe(false);
  });
});

describe("withinActiveHours", () => {
  const at = (h: number, m = 0) => new Date(2026, 6, 12, h, m);
  it("handles a normal daytime window", () => {
    expect(withinActiveHours(at(8), "07:00", "23:00")).toBe(true);
    expect(withinActiveHours(at(3), "07:00", "23:00")).toBe(false);
  });
  it("handles a window that wraps midnight", () => {
    expect(withinActiveHours(at(1), "22:00", "02:00")).toBe(true);
    expect(withinActiveHours(at(12), "22:00", "02:00")).toBe(false);
  });
});

describe("applyJitter", () => {
  it("is the identity when disabled", () => {
    expect(applyJitter(1000, false, 120, () => 0.5)).toBe(1000);
  });
  it("adds 0..N seconds when enabled and clamps N to 120", () => {
    expect(applyJitter(1000, true, 120, () => 0)).toBe(1000);
    expect(applyJitter(1000, true, 120, () => 0.5)).toBe(1000 + 60_000);
    expect(applyJitter(1000, true, 999, () => 0.999999)).toBeLessThanOrEqual(1000 + 120_000);
  });
});

describe("nextScheduledOccurrence", () => {
  it("returns today's time when it is still ahead", () => {
    const from = new Date(2026, 6, 13, 6, 0); // Mon 06:00
    const when = new Date(nextScheduledOccurrence("08:00", from, []));
    expect(when.getHours()).toBe(8);
    expect(when.getDate()).toBe(13);
  });
  it("rolls to tomorrow when the time already passed", () => {
    const from = new Date(2026, 6, 13, 9, 0);
    const when = new Date(nextScheduledOccurrence("08:00", from, []));
    expect(when.getDate()).toBe(14);
  });
  it("skips off-days", () => {
    const from = new Date(2026, 6, 17, 9, 0); // Fri 09:00
    const when = new Date(nextScheduledOccurrence("08:00", from, [5, 6]));
    expect(when.getDay()).toBe(0);
    expect(when.getDate()).toBe(19);
  });
});

describe("nextSmartFire", () => {
  const start = "07:00", end = "23:00";
  it("primes now when the window has lapsed and we're in an allowed slot", () => {
    const from = new Date(2026, 6, 13, 10, 0);
    const r = nextSmartFire(from, from.getTime() - 1000, [], true, start, end);
    expect(r.primeNow).toBe(true);
    expect(r.fireAt).toBe(from.getTime());
  });
  it("defers to resetAt when the window is still active", () => {
    const from = new Date(2026, 6, 13, 10, 0);
    const reset = from.getTime() + 3_600_000;
    const r = nextSmartFire(from, reset, [], true, start, end);
    expect(r.primeNow).toBe(false);
    expect(r.fireAt).toBe(reset);
  });
  it("defers past off-hours to the next active opening", () => {
    const from = new Date(2026, 6, 13, 3, 0);
    const r = nextSmartFire(from, 0, [], true, start, end);
    expect(r.primeNow).toBe(false);
    const when = new Date(r.fireAt);
    expect(when.getHours()).toBe(7);
    expect(when.getDate()).toBe(13);
  });
});

const alarmBase = {
  primerEnabled: true, primerMode: "scheduled" as const,
  primerTimes: ["08:00", "13:00"], primerOffDays: [] as number[],
  primerTargetClaude: true, primerTargetCodex: true,
  primerJitterEnabled: false, primerJitterSeconds: 120,
};

describe("desiredPrimerAlarmNames", () => {
  it("is empty when disabled or no targets", () => {
    expect(desiredPrimerAlarmNames({ ...alarmBase, primerEnabled: false })).toEqual([]);
    expect(desiredPrimerAlarmNames({ ...alarmBase, primerTargetClaude: false, primerTargetCodex: false })).toEqual([]);
  });
  it("scheduled mode → one alarm per time (targets share times)", () => {
    expect(desiredPrimerAlarmNames(alarmBase)).toEqual([
      "aleph-primer-sched-08:00", "aleph-primer-sched-13:00",
    ]);
  });
  it("smart mode → one alarm per enabled target", () => {
    expect(desiredPrimerAlarmNames({ ...alarmBase, primerMode: "smart" })).toEqual([
      "aleph-primer-smart-claude", "aleph-primer-smart-codex",
    ]);
  });
});

describe("computeAlarmWhen", () => {
  it("smart alarm fires ~now (bootstrap)", () => {
    const from = new Date(2026, 6, 13, 10, 0);
    expect(computeAlarmWhen("aleph-primer-smart-codex", from, alarmBase, () => 0)).toBe(from.getTime());
  });
  it("scheduled alarm resolves the embedded time", () => {
    const from = new Date(2026, 6, 13, 6, 0);
    const when = new Date(computeAlarmWhen("aleph-primer-sched-08:00", from, alarmBase, () => 0));
    expect(when.getHours()).toBe(8);
  });
});
