// Pure primer helpers — no chrome/DOM access. RNG is injected so every
// function here is deterministic under test. Consumed by primer.ts.

export type PrimerTarget = "claude" | "codex";

export const PRIMER_GREETINGS = [
  "hi", "hello", "hey", "hey there", "hi there", "hiya", "howdy", "yo",
  "morning", "sup", "hey!", "hello!", "ping", "you around?", "just checking in",
  "what is the first letter of the hebrew alphabet?",
];

/** Uniformly-random roster member. rng() in [0,1). */
export function pickGreeting(rng: () => number): string {
  return PRIMER_GREETINGS[Math.floor(rng() * PRIMER_GREETINGS.length)];
}

/** JS getDay(): 0=Sun..6=Sat. */
export function isOffDay(date: Date, offDays: number[]): boolean {
  return offDays.includes(date.getDay());
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Is date's local clock time within [start,end]? Supports start>end (wraps midnight). */
export function withinActiveHours(date: Date, start: string, end: string): boolean {
  const t = date.getHours() * 60 + date.getMinutes();
  const s = toMinutes(start), e = toMinutes(end);
  return s <= e ? (t >= s && t <= e) : (t >= s || t <= e);
}

/** Additive jitter in SECONDS (0..N, N clamped 0..120); identity when disabled. */
export function applyJitter(fireAt: number, enabled: boolean, jitterSeconds: number, rng: () => number): number {
  if (!enabled) return fireAt;
  const n = Math.max(0, Math.min(120, jitterSeconds));
  return fireAt + Math.floor(rng() * n * 1000);
}

/** Next epoch-ms for a daily "HH:MM" at or after `from`, skipping off-days. */
export function nextScheduledOccurrence(time: string, from: Date, offDays: number[]): number {
  const [h, m] = time.split(":").map(Number);
  const d = new Date(from);
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= from.getTime()) d.setDate(d.getDate() + 1);
  for (let i = 0; i < 7 && isOffDay(d, offDays); i++) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** First minute-aligned instant at/after `from` on a working day within active hours. */
function nextAllowedOpening(from: Date, offDays: number[], activeHoursEnabled: boolean, start: string, end: string): number {
  const d = new Date(from);
  d.setSeconds(0, 0);
  for (let i = 0; i < 8 * 24 * 60; i++) {
    if (!isOffDay(d, offDays) && (!activeHoursEnabled || withinActiveHours(d, start, end))) return d.getTime();
    d.setMinutes(d.getMinutes() + 1);
  }
  return d.getTime();
}

/**
 * Smart mode: given the target's known window reset (0/past = lapsed), decide
 * whether to prime now and when the next alarm should fire.
 */
export function nextSmartFire(
  from: Date, resetAt: number, offDays: number[],
  activeHoursEnabled: boolean, start: string, end: string,
): { fireAt: number; primeNow: boolean } {
  const now = from.getTime();
  const base = resetAt > now ? resetAt : now;
  const baseDate = new Date(base);
  const allowed = !isOffDay(baseDate, offDays) &&
    (!activeHoursEnabled || withinActiveHours(baseDate, start, end));
  if (base <= now && allowed) return { fireAt: now, primeNow: true };
  if (allowed) return { fireAt: base, primeNow: false };
  return { fireAt: nextAllowedOpening(baseDate, offDays, activeHoursEnabled, start, end), primeNow: false };
}

export const PRIMER_ALARM_PREFIX = "aleph-primer";

interface AlarmSettings {
  primerEnabled: boolean;
  primerMode: "scheduled" | "smart";
  primerTimes: string[];
  primerTargetClaude: boolean;
  primerTargetCodex: boolean;
}

/** Alarm names that SHOULD exist for the given settings. */
export function desiredPrimerAlarmNames(s: AlarmSettings): string[] {
  if (!s.primerEnabled) return [];
  const targets: PrimerTarget[] = [];
  if (s.primerTargetClaude) targets.push("claude");
  if (s.primerTargetCodex) targets.push("codex");
  if (!targets.length) return [];
  if (s.primerMode === "scheduled") {
    return s.primerTimes.map((t) => `${PRIMER_ALARM_PREFIX}-sched-${t}`);
  }
  return targets.map((t) => `${PRIMER_ALARM_PREFIX}-smart-${t}`);
}

interface WhenSettings {
  primerOffDays: number[];
  primerJitterEnabled: boolean;
  primerJitterSeconds: number;
}

/** The epoch-ms an alarm should fire at. Smart → now (bootstrap; the run re-arms). */
export function computeAlarmWhen(name: string, from: Date, s: WhenSettings, rng: () => number): number {
  if (name.startsWith(`${PRIMER_ALARM_PREFIX}-smart-`)) {
    return applyJitter(from.getTime(), s.primerJitterEnabled, s.primerJitterSeconds, rng);
  }
  const time = name.slice(`${PRIMER_ALARM_PREFIX}-sched-`.length);
  const bs = nextScheduledOccurrence(time, from, s.primerOffDays);
  return applyJitter(bs, s.primerJitterEnabled, s.primerJitterSeconds, rng);
}
