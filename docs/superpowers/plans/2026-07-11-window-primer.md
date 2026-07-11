# Window Primer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in feature that, on a schedule, sends one tiny message to Claude and the OpenAI Codex 5-hour window to start the rolling usage limit early — headless, self-cleaning, with anti-fingerprint jitter/greeting variation and failure surfacing.

**Architecture:** A new background submodule (`primer.ts`) driven entirely through the *existing* `registerBackgroundListeners()` hooks (alarm, storage-change, message, install/startup) so it stays define-only at import (MV3 first-sync-turn rule). All date/gating/jitter/greeting/request logic lives in pure, unit-tested helpers (`primerSchedule.ts`, `primerRequests.ts`); the impure `primer.ts` composes them with the session/cookie auth already used to *read* usage (`providerUsage.ts`). `chrome.alarms` (permission already granted) schedules; scheduled mode fires per configured local time, smart mode self-chains to each window's own reset. Settings live in `chrome.storage.sync` via `DEFAULTS`; runtime status in `chrome.storage.local`.

**Tech Stack:** TypeScript (strict), esbuild bundles, Vitest (node env) unit tests, Chrome MV3 (`chrome.alarms`, `chrome.storage`, `chrome.action`, `chrome.scripting` for the fallback), `fetch` with `credentials:"include"`.

## Global Constraints

- **Zero `tsc` errors repo-wide**; `any` only at commented boundaries (raw provider/storage JSON). `npm run check` = typecheck + lint + test + build must pass.
- **Never edit `dist/`** — build output. Edit `src/`, then `npm run build`.
- **Background submodules are define-only at import time** — no top-level `chrome.*` listener registration outside `registerBackgroundListeners()`; export functions, call them from `router.ts`.
- **Settings keys** live in `DEFAULTS` (`src/shared/defaults.ts`); `filterToDefaults` already guards import/sync — no extra wiring. Array/enum defaults need explicit `as` annotations.
- **Types in `src/shared/messages.ts` describe the wire — never change what is sent by editing a type.**
- **Message-key strings** for primer: `aleph-primer-run-now`, `aleph-primer-status`. **Alarm-name prefix:** `aleph-primer` (`aleph-primer-sched-<HH:MM>`, `aleph-primer-smart-<target>`).
- **Send is API replay, never composer typing.** Codex body must carry non-empty `instructions` and `store:false`. Claude flow is create→completion→delete with `model` omitted.
- **Jitter:** additive, 0..N **seconds**, N clamped to 0..120, toggleable. **Greeting roster:** `PRIMER_GREETINGS`, uniform random pick. RNG **injected** into pure helpers for deterministic tests.
- **ToS/account-safety:** opt-in, off by default; the Settings section must show the disclosure line and the smart-mode risk note (verbatim strings in Task 11).
- Tests run via `npx vitest run <file>` (single) / `npm test` (all).

---

### Task 1: Settings defaults

**Files:**
- Modify: `src/shared/defaults.ts:1-26` (add primer keys to `DEFAULTS`)
- Test: `tests/unit/defaults-themes.spec.ts` (extend — this is the existing DEFAULTS spec)

**Interfaces:**
- Produces: 12 new `DEFAULTS` keys → `Settings` type gains `primerEnabled: boolean`, `primerMode: "scheduled"|"smart"`, `primerTimes: string[]`, `primerOffDays: number[]`, `primerActiveHoursEnabled: boolean`, `primerActiveStart: string`, `primerActiveEnd: string`, `primerTargetClaude: boolean`, `primerTargetCodex: boolean`, `primerAutoDeleteClaude: boolean`, `primerJitterEnabled: boolean`, `primerJitterSeconds: number`.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/defaults-themes.spec.ts`:

```ts
import { DEFAULTS } from "../../src/background/../shared/defaults";

it("defines primer defaults with correct types", () => {
  expect(DEFAULTS.primerEnabled).toBe(false);
  expect(DEFAULTS.primerMode).toBe("scheduled");
  expect(DEFAULTS.primerTimes).toEqual([]);
  expect(DEFAULTS.primerOffDays).toEqual([]);
  expect(DEFAULTS.primerActiveHoursEnabled).toBe(false);
  expect(DEFAULTS.primerActiveStart).toBe("07:00");
  expect(DEFAULTS.primerActiveEnd).toBe("23:00");
  expect(DEFAULTS.primerTargetClaude).toBe(true);
  expect(DEFAULTS.primerTargetCodex).toBe(true);
  expect(DEFAULTS.primerAutoDeleteClaude).toBe(true);
  expect(DEFAULTS.primerJitterEnabled).toBe(true);
  expect(DEFAULTS.primerJitterSeconds).toBe(120);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/defaults-themes.spec.ts`
Expected: FAIL — `DEFAULTS.primerEnabled` is `undefined`.

- [ ] **Step 3: Add the keys**

In `src/shared/defaults.ts`, before the closing `};` of `DEFAULTS`:

```ts
  miniGame: false,
  // Window Primer — opt-in scheduled/smart usage-window warm-up.
  primerEnabled: false,
  primerMode: "scheduled" as "scheduled" | "smart",
  primerTimes: [] as string[],
  primerOffDays: [] as number[],          // JS getDay(): 0=Sun … 6=Sat
  primerActiveHoursEnabled: false,
  primerActiveStart: "07:00",
  primerActiveEnd: "23:00",
  primerTargetClaude: true,
  primerTargetCodex: true,
  primerAutoDeleteClaude: true,
  primerJitterEnabled: true,
  primerJitterSeconds: 120,               // random 0..N s added to every fire; N clamped 0..120
```

(The `miniGame: false,` line already exists — the new lines go directly after it, inside the object.)

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run tests/unit/defaults-themes.spec.ts && npm run typecheck`
Expected: PASS; zero tsc errors. (If `primerTimes` errors as `never[]`, the `as string[]` annotation is missing.)

- [ ] **Step 5: Commit**

```bash
git add src/shared/defaults.ts tests/unit/defaults-themes.spec.ts
git commit -m "feat(primer): add Window Primer settings defaults"
```

---

### Task 2: Pure helpers — greeting, gating, jitter

**Files:**
- Create: `src/background/primerSchedule.ts`
- Test: `tests/unit/primer-schedule.spec.ts`

**Interfaces:**
- Produces: `PRIMER_GREETINGS: string[]`; `pickGreeting(rng: () => number): string`; `isOffDay(date: Date, offDays: number[]): boolean`; `withinActiveHours(date: Date, start: string, end: string): boolean`; `applyJitter(fireAt: number, enabled: boolean, jitterSeconds: number, rng: () => number): number`. `rng()` returns a float in `[0,1)`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/primer-schedule.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  PRIMER_GREETINGS, pickGreeting, isOffDay, withinActiveHours, applyJitter,
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/primer-schedule.spec.ts`
Expected: FAIL — module `primerSchedule` not found.

- [ ] **Step 3: Implement**

Create `src/background/primerSchedule.ts`:

```ts
// Pure primer helpers — no chrome/DOM access. RNG is injected so every
// function here is deterministic under test. See docs/superpowers/plans.

export type PrimerTarget = "claude" | "codex";

export const PRIMER_GREETINGS = [
  "hi", "hello", "hey", "hey there", "hi there", "hiya", "howdy", "yo",
  "morning", "sup", "hey!", "hello!", "ping", "you around?", "just checking in",
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/primer-schedule.spec.ts`
Expected: PASS (all describes green).

- [ ] **Step 5: Commit**

```bash
git add src/background/primerSchedule.ts tests/unit/primer-schedule.spec.ts
git commit -m "feat(primer): pure greeting/gating/jitter helpers"
```

---

### Task 3: Pure helpers — next-fire scheduling

**Files:**
- Modify: `src/background/primerSchedule.ts` (append)
- Test: `tests/unit/primer-schedule.spec.ts` (append)

**Interfaces:**
- Consumes: `isOffDay`, `withinActiveHours` (Task 2).
- Produces: `nextScheduledOccurrence(time: string, from: Date, offDays: number[]): number`; `nextSmartFire(from: Date, resetAt: number, offDays: number[], activeHoursEnabled: boolean, start: string, end: string): { fireAt: number; primeNow: boolean }`. Both return epoch-ms.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/primer-schedule.spec.ts`:

```ts
import { nextScheduledOccurrence, nextSmartFire } from "../../src/background/primerSchedule";

describe("nextScheduledOccurrence", () => {
  it("returns today's time when it is still ahead", () => {
    const from = new Date(2026, 6, 13, 6, 0); // Mon 06:00
    const when = new Date(nextScheduledOccurrence("08:00", from, []));
    expect(when.getHours()).toBe(8);
    expect(when.getDate()).toBe(13);
  });
  it("rolls to tomorrow when the time already passed", () => {
    const from = new Date(2026, 6, 13, 9, 0); // Mon 09:00
    const when = new Date(nextScheduledOccurrence("08:00", from, []));
    expect(when.getDate()).toBe(14);
  });
  it("skips off-days", () => {
    const from = new Date(2026, 6, 17, 9, 0); // Fri 09:00, want 08:00
    // Fri=5, Sat=6 off → next is Sun the 19th
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
    const from = new Date(2026, 6, 13, 3, 0); // 03:00, before 07:00
    const r = nextSmartFire(from, 0, [], true, start, end);
    expect(r.primeNow).toBe(false);
    const when = new Date(r.fireAt);
    expect(when.getHours()).toBe(7);
    expect(when.getDate()).toBe(13);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/primer-schedule.spec.ts`
Expected: FAIL — `nextScheduledOccurrence` is not exported.

- [ ] **Step 3: Implement**

Append to `src/background/primerSchedule.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/primer-schedule.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/background/primerSchedule.ts tests/unit/primer-schedule.spec.ts
git commit -m "feat(primer): next-fire scheduling helpers"
```

---

### Task 4: Pure helpers — alarm naming & timing

**Files:**
- Modify: `src/background/primerSchedule.ts` (append)
- Test: `tests/unit/primer-schedule.spec.ts` (append)

**Interfaces:**
- Consumes: `nextScheduledOccurrence`, `applyJitter`.
- Produces: `PRIMER_ALARM_PREFIX = "aleph-primer"`; `desiredPrimerAlarmNames(s): string[]`; `computeAlarmWhen(name: string, from: Date, s, rng: () => number): number`. `s` is a subset of `Settings` (fields referenced below).

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/primer-schedule.spec.ts`:

```ts
import { PRIMER_ALARM_PREFIX, desiredPrimerAlarmNames, computeAlarmWhen } from "../../src/background/primerSchedule";

const base = {
  primerEnabled: true, primerMode: "scheduled" as const,
  primerTimes: ["08:00", "13:00"], primerOffDays: [] as number[],
  primerTargetClaude: true, primerTargetCodex: true,
  primerJitterEnabled: false, primerJitterSeconds: 120,
};

describe("desiredPrimerAlarmNames", () => {
  it("is empty when disabled or no targets", () => {
    expect(desiredPrimerAlarmNames({ ...base, primerEnabled: false })).toEqual([]);
    expect(desiredPrimerAlarmNames({ ...base, primerTargetClaude: false, primerTargetCodex: false })).toEqual([]);
  });
  it("scheduled mode → one alarm per time (targets share times)", () => {
    expect(desiredPrimerAlarmNames(base)).toEqual([
      "aleph-primer-sched-08:00", "aleph-primer-sched-13:00",
    ]);
  });
  it("smart mode → one alarm per enabled target", () => {
    expect(desiredPrimerAlarmNames({ ...base, primerMode: "smart" })).toEqual([
      "aleph-primer-smart-claude", "aleph-primer-smart-codex",
    ]);
  });
});

describe("computeAlarmWhen", () => {
  it("smart alarm fires ~now (bootstrap)", () => {
    const from = new Date(2026, 6, 13, 10, 0);
    expect(computeAlarmWhen("aleph-primer-smart-codex", from, base, () => 0)).toBe(from.getTime());
  });
  it("scheduled alarm resolves the embedded time", () => {
    const from = new Date(2026, 6, 13, 6, 0);
    const when = new Date(computeAlarmWhen("aleph-primer-sched-08:00", from, base, () => 0));
    expect(when.getHours()).toBe(8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/primer-schedule.spec.ts`
Expected: FAIL — `desiredPrimerAlarmNames` not exported.

- [ ] **Step 3: Implement**

Append to `src/background/primerSchedule.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/primer-schedule.spec.ts && npm run typecheck`
Expected: PASS; zero tsc errors.

- [ ] **Step 5: Commit**

```bash
git add src/background/primerSchedule.ts tests/unit/primer-schedule.spec.ts
git commit -m "feat(primer): alarm naming and timing helpers"
```

---

### Task 5: Pure request builders + response parsing

**Files:**
- Create: `src/background/primerRequests.ts`
- Test: `tests/unit/primer-requests.spec.ts`

**Interfaces:**
- Produces:
  - `interface HttpRequest { url: string; method: string; headers: Record<string,string>; body?: string }`
  - `buildCodexPrimerRequest(o: { origin: string; token: string; accountId: string; model: string; greeting: string }): HttpRequest`
  - `buildClaudeCreateRequest(orgId: string, convUuid: string): HttpRequest`
  - `buildClaudeCompletionRequest(orgId: string, convUuid: string, greeting: string, timezone: string): HttpRequest`
  - `buildClaudeDeleteRequest(orgId: string, convUuid: string): HttpRequest`
  - `parseCodexPrimary(h: { get(name: string): string | null }): { resetAt: number | null; usedPercent: number | null }`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/primer-requests.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildCodexPrimerRequest, buildClaudeCreateRequest,
  buildClaudeCompletionRequest, buildClaudeDeleteRequest, parseCodexPrimary,
} from "../../src/background/primerRequests";

describe("buildCodexPrimerRequest", () => {
  const r = buildCodexPrimerRequest({
    origin: "https://chatgpt.com", token: "T", accountId: "A",
    model: "gpt-5-codex-mini", greeting: "hi",
  });
  it("targets the responses endpoint with bearer + account id", () => {
    expect(r.url).toBe("https://chatgpt.com/backend-api/codex/responses");
    expect(r.method).toBe("POST");
    expect(r.headers.Authorization).toBe("Bearer T");
    expect(r.headers["ChatGPT-Account-ID"]).toBe("A");
    expect(r.headers.Accept).toBe("text/event-stream");
    expect(r.headers.originator).toBe("codex_cli_rs");
  });
  it("sends a non-empty instructions and store:false body", () => {
    const b = JSON.parse(r.body!);
    expect(b.instructions).toBeTruthy();
    expect(b.store).toBe(false);
    expect(b.stream).toBe(true);
    expect(b.input[0].content[0].text).toBe("hi");
  });
});

describe("Claude requests", () => {
  it("create posts name+uuid", () => {
    const r = buildClaudeCreateRequest("ORG", "U");
    expect(r.url).toBe("https://claude.ai/api/organizations/ORG/chat_conversations");
    expect(JSON.parse(r.body!)).toEqual({ name: "", uuid: "U" });
  });
  it("completion omits model and streams", () => {
    const r = buildClaudeCompletionRequest("ORG", "U", "hey", "Etc/UTC");
    expect(r.url).toBe("https://claude.ai/api/organizations/ORG/chat_conversations/U/completion");
    const b = JSON.parse(r.body!);
    expect(b).toEqual({ prompt: "hey", timezone: "Etc/UTC", attachments: [], files: [] });
    expect("model" in b).toBe(false);
  });
  it("delete targets the conversation with a quoted-uuid body", () => {
    const r = buildClaudeDeleteRequest("ORG", "U");
    expect(r.method).toBe("DELETE");
    expect(r.url).toBe("https://claude.ai/api/organizations/ORG/chat_conversations/U");
    expect(r.body).toBe('"U"');
  });
});

describe("parseCodexPrimary", () => {
  it("reads reset (unix s → ms) and used percent from headers", () => {
    const h = new Map([
      ["x-codex-primary-reset-at", "1000"],
      ["x-codex-primary-used-percent", "3"],
    ]);
    const p = parseCodexPrimary({ get: (n) => h.get(n) ?? null });
    expect(p.resetAt).toBe(1_000_000);
    expect(p.usedPercent).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/primer-requests.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/background/primerRequests.ts`:

```ts
// Pure HTTP request builders + response parsing for the Window Primer.
// No chrome/fetch here — executors (primer.ts) run these.

export interface HttpRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** Codex: the metered turn that starts the 5h window (store:false → nothing persists). */
export function buildCodexPrimerRequest(o: {
  origin: string; token: string; accountId: string; model: string; greeting: string;
}): HttpRequest {
  return {
    url: o.origin + "/backend-api/codex/responses",
    method: "POST",
    headers: {
      "Authorization": "Bearer " + o.token,
      "ChatGPT-Account-ID": o.accountId,
      "Content-Type": "application/json",
      "Accept": "text/event-stream",
      "originator": "codex_cli_rs",
    },
    body: JSON.stringify({
      model: o.model,
      instructions: "You are a helpful assistant.",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: o.greeting }] }],
      tool_choice: "auto",
      parallel_tool_calls: false,
      reasoning: null,
      store: false,
      stream: true,
      include: [],
    }),
  };
}

export function buildClaudeCreateRequest(orgId: string, convUuid: string): HttpRequest {
  return {
    url: `https://claude.ai/api/organizations/${orgId}/chat_conversations`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "", uuid: convUuid }),
  };
}

/** The completion starts Claude's 5h window. `model` intentionally omitted (account default). */
export function buildClaudeCompletionRequest(orgId: string, convUuid: string, greeting: string, timezone: string): HttpRequest {
  return {
    url: `https://claude.ai/api/organizations/${orgId}/chat_conversations/${convUuid}/completion`,
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
    body: JSON.stringify({ prompt: greeting, timezone, attachments: [], files: [] }),
  };
}

export function buildClaudeDeleteRequest(orgId: string, convUuid: string): HttpRequest {
  return {
    url: `https://claude.ai/api/organizations/${orgId}/chat_conversations/${convUuid}`,
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(convUuid),
  };
}

/** Codex rate-limit headers on the responses POST. reset-at is unix seconds. */
export function parseCodexPrimary(h: { get(name: string): string | null }): { resetAt: number | null; usedPercent: number | null } {
  const reset = h.get("x-codex-primary-reset-at");
  const used = h.get("x-codex-primary-used-percent");
  return {
    resetAt: reset ? Number(reset) * 1000 : null,
    usedPercent: used != null ? Number(used) : null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/primer-requests.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/background/primerRequests.ts tests/unit/primer-requests.spec.ts
git commit -m "feat(primer): pure request builders and response parsing"
```

---

### Task 6: Export the session/cookie auth helpers

**Files:**
- Modify: `src/background/providerUsage.ts` (add `export` to 4 functions: `fetchJson` ~L78, `fetchChatgptSession` ~L208, `getCookie` ~L286, `getClaudeOrgId` ~L331)

**Interfaces:**
- Produces (now importable from `providerUsage.ts`): `fetchJson(url: string, options?: RequestInit): Promise<unknown>`; `fetchChatgptSession(): Promise<{ origin: string; token: string | null; accountId: string | null; plan: unknown } | null>`; `getCookie(details: chrome.cookies.CookieDetails): Promise<chrome.cookies.Cookie | null>`; `getClaudeOrgId(): Promise<string | null>`.

- [ ] **Step 1: Add `export`**

In `src/background/providerUsage.ts`, prepend `export` to each declaration (do not change bodies):

```ts
export async function fetchJson(url: string, options: RequestInit = {}): Promise<unknown> {
```
```ts
export async function fetchChatgptSession(): Promise<ChatgptSession | null> {
```
```ts
export function getCookie(details: chrome.cookies.CookieDetails): Promise<chrome.cookies.Cookie | null> {
```
```ts
export async function getClaudeOrgId(): Promise<string | null> {
```

Also add `export` to the `ChatgptSession` type alias (~L206) so consumers can name it:
```ts
export type ChatgptSession = { origin: string; token: string | null; accountId: string | null; plan: ChatgptPlan | null };
```

- [ ] **Step 2: Verify nothing else broke**

Run: `npm run typecheck`
Expected: zero tsc errors (adding `export` is non-breaking).

- [ ] **Step 3: Commit**

```bash
git add src/background/providerUsage.ts
git commit -m "refactor(primer): export session/cookie auth helpers for reuse"
```

---

### Task 7: Primer status store + failure badge

**Files:**
- Create: `src/background/primer.ts` (status portion)
- Test: `tests/unit/primer-status.spec.ts`

**Interfaces:**
- Consumes: `readLocal`, `writeLocal` from `usage.ts` (signatures: `readLocal<T>(key: string, fallback: T): Promise<T>`, `writeLocal(key: string, value: unknown): Promise<void>`).
- Produces: `PRIMER_STATUS_KEY = "primer_status"`; `type PrimerRunResult = { at: number; ok: boolean; reason?: string; windowResetAt?: number; usedPercent?: number }`; `recordPrimerResult(target: PrimerTarget, r: PrimerRunResult): Promise<void>`; `getPrimerStatus(): Promise<Record<string, PrimerRunResult>>` (also clears the failure badge); `raiseFailureBadge(): void`; `clearFailureBadge(): void`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/primer-status.spec.ts`:

```ts
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
    const setBadgeText = vi.fn();
    vi.stubGlobal("chrome", { action: { setBadgeText, setBadgeBackgroundColor: vi.fn() } });
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/primer-status.spec.ts`
Expected: FAIL — module `primer` not found.

- [ ] **Step 3: Implement**

Create `src/background/primer.ts` (this file grows in Tasks 8–9; start with the status portion):

```ts
import { readLocal, writeLocal, enqueueUsageWork } from "./usage";
import type { PrimerTarget } from "./primerSchedule";

export const PRIMER_STATUS_KEY = "primer_status";

export interface PrimerRunResult {
  at: number;
  ok: boolean;
  reason?: string;
  windowResetAt?: number;
  usedPercent?: number;
}

// A failed primer sets a global toolbar "!" (no tabId). The per-tab feature-count
// badge still overrides on AI-platform tabs; on every other tab the "!" is visible.
export function raiseFailureBadge(): void {
  try {
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#e5484d" });
  } catch (e) { /* action API may be absent in tests */ }
}

export function clearFailureBadge(): void {
  try { chrome.action.setBadgeText({ text: "" }); } catch (e) { /* noop */ }
}

export async function recordPrimerResult(target: PrimerTarget, r: PrimerRunResult): Promise<void> {
  await enqueueUsageWork(async () => {
    const all = await readLocal<Record<string, PrimerRunResult>>(PRIMER_STATUS_KEY, {});
    all[target] = r;
    await writeLocal(PRIMER_STATUS_KEY, all);
  });
  if (!r.ok) raiseFailureBadge();
}

/** Reads the status map and clears the failure badge (the user has now seen it). */
export async function getPrimerStatus(): Promise<Record<string, PrimerRunResult>> {
  clearFailureBadge();
  return readLocal<Record<string, PrimerRunResult>>(PRIMER_STATUS_KEY, {});
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/primer-status.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/background/primer.ts tests/unit/primer-status.spec.ts
git commit -m "feat(primer): status store and failure badge"
```

---

### Task 8: Send executors (Codex + Claude)

**Files:**
- Modify: `src/background/primer.ts` (append executors + window reads)
- Test: `tests/unit/primer-send.spec.ts`

**Interfaces:**
- Consumes: `fetchChatgptSession`, `getClaudeOrgId`, `fetchJson` (Task 6); builders + `parseCodexPrimary` (Task 5); `pickGreeting` (Task 2).
- Produces:
  - `readCodexWindow(): Promise<{ active: boolean; resetAt: number | null }>`
  - `readClaudeWindow(): Promise<{ active: boolean; resetAt: number | null }>`
  - `sendCodexPrimer(rng?: () => number): Promise<PrimerRunResult>`
  - `sendClaudePrimer(autoDelete: boolean, rng?: () => number): Promise<PrimerRunResult>`

Note on testability: executors call the global `fetch` and the auth helpers; the test stubs both. Keep `fetch` usage minimal (one call per request; drain via `res.text()`).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/primer-send.spec.ts`:

```ts
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
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://chatgpt.com/backend-api/codex/responses");
    expect((init as RequestInit).method).toBe("POST");
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/primer-send.spec.ts`
Expected: FAIL — `sendCodexPrimer` not exported.

- [ ] **Step 3: Implement**

Append to `src/background/primer.ts` (add imports at top too):

```ts
import { fetchChatgptSession, getClaudeOrgId, fetchJson } from "./providerUsage";
import {
  buildCodexPrimerRequest, buildClaudeCreateRequest,
  buildClaudeCompletionRequest, buildClaudeDeleteRequest, parseCodexPrimary,
} from "./primerRequests";
import { pickGreeting } from "./primerSchedule";

const DEFAULT_CODEX_MODEL = "gpt-5-codex-mini";

async function doFetch(req: { url: string; method: string; headers: Record<string, string>; body?: string }): Promise<Response> {
  return fetch(req.url, { method: req.method, headers: req.headers, body: req.body, credentials: "include" });
}

/** Read Codex primary-window state (skip-if-active + verify). */
export async function readCodexWindow(): Promise<{ active: boolean; resetAt: number | null }> {
  try {
    const session = await fetchChatgptSession();
    const headers: HeadersInit = session?.token
      ? { Authorization: "Bearer " + session.token, ...(session.accountId ? { "ChatGPT-Account-ID": session.accountId } : {}) }
      : {};
    const origin = session?.origin || "https://chatgpt.com";
    const usage = await fetchJson(origin + "/backend-api/wham/usage", { headers, credentials: "include" }) as any;
    const resetSec = usage?.primary?.reset_after_seconds ?? usage?.rate_limits?.primary?.resets_at ?? null;
    // wham exposes reset as either an absolute epoch (resets_at) or relative — normalize to ms.
    const resetAt = typeof resetSec === "number" ? (resetSec > 1e6 ? resetSec * 1000 : Date.now() + resetSec * 1000) : null;
    return { active: resetAt != null && resetAt > Date.now(), resetAt };
  } catch (e) { return { active: false, resetAt: null }; }
}

/** Read Claude 5h-window state via the org usage endpoint (fields per normalizeClaudeUsage). */
export async function readClaudeWindow(): Promise<{ active: boolean; resetAt: number | null }> {
  try {
    const orgId = await getClaudeOrgId();
    if (!orgId) return { active: false, resetAt: null };
    const usage = await fetchJson(`https://claude.ai/api/organizations/${orgId}/usage`, { credentials: "include" }) as any;
    const iso = usage?.five_hour?.resets_at ?? null;
    const resetAt = iso ? Date.parse(iso) : null;
    return { active: resetAt != null && resetAt > Date.now(), resetAt };
  } catch (e) { return { active: false, resetAt: null }; }
}

export async function sendCodexPrimer(rng: () => number = Math.random): Promise<PrimerRunResult> {
  const at = Date.now();
  const session = await fetchChatgptSession();
  if (!session?.token || !session.accountId) return { at, ok: false, reason: "signed out of ChatGPT" };
  const req = buildCodexPrimerRequest({
    origin: session.origin, token: session.token, accountId: session.accountId,
    model: DEFAULT_CODEX_MODEL, greeting: pickGreeting(rng),
  });
  const res = await doFetch(req);
  if (!res.ok) return { at, ok: false, reason: `codex responses ${res.status}` };
  await res.text(); // drain SSE
  const primary = parseCodexPrimary(res.headers);
  return { at, ok: true, windowResetAt: primary.resetAt ?? undefined, usedPercent: primary.usedPercent ?? undefined };
}

export async function sendClaudePrimer(autoDelete: boolean, rng: () => number = Math.random): Promise<PrimerRunResult> {
  const at = Date.now();
  const orgId = await getClaudeOrgId();
  if (!orgId) return { at, ok: false, reason: "signed out of Claude" };
  const convUuid = crypto.randomUUID();
  const create = await doFetch(buildClaudeCreateRequest(orgId, convUuid));
  if (!create.ok) return { at, ok: false, reason: `claude create ${create.status}` };
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC";
  const comp = await doFetch(buildClaudeCompletionRequest(orgId, convUuid, pickGreeting(rng), tz));
  if (!comp.ok) return { at, ok: false, reason: `claude completion ${comp.status}` };
  await comp.text(); // drain SSE
  if (autoDelete) { try { await doFetch(buildClaudeDeleteRequest(orgId, convUuid)); } catch (e) { /* best-effort */ } }
  const win = await readClaudeWindow();
  return { at, ok: true, windowResetAt: win.resetAt ?? undefined };
}
```

> **Implementation note:** the `wham/usage` reset field name (`primary.reset_after_seconds` vs `rate_limits.primary.resets_at`) is normalized defensively above; confirm the exact field against a live `GET /backend-api/wham/usage` during Task 14 and tighten if needed. This is a read used only for skip-if-active — a wrong guess degrades to "not active" (a harmless extra prime), never a crash.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/primer-send.spec.ts && npm run typecheck`
Expected: PASS; zero tsc errors.

- [ ] **Step 5: Commit**

```bash
git add src/background/primer.ts tests/unit/primer-send.spec.ts
git commit -m "feat(primer): Codex and Claude send executors"
```

---

### Task 9: Orchestration — runPrimer, alarms, handlers

**Files:**
- Modify: `src/background/primer.ts` (append orchestration)
- Test: `tests/unit/primer-orchestration.spec.ts`

**Interfaces:**
- Consumes: everything above; `desiredPrimerAlarmNames`, `computeAlarmWhen`, `nextSmartFire`, `PRIMER_ALARM_PREFIX` (Tasks 3–4).
- Produces:
  - `runPrimer(target: PrimerTarget): Promise<PrimerRunResult>` (reads settings, skip-if-active, sends, records)
  - `runPrimerNow(target?: PrimerTarget): Promise<Record<string, PrimerRunResult>>`
  - `reconcilePrimerAlarms(): Promise<void>` (clear all `aleph-primer*`, create desired)
  - `handlePrimerAlarm(name: string): Promise<void>` (run + re-arm)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/primer-orchestration.spec.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

const settings: Record<string, unknown> = {
  primerEnabled: true, primerMode: "scheduled", primerTimes: ["08:00"],
  primerOffDays: [], primerActiveHoursEnabled: false, primerActiveStart: "07:00", primerActiveEnd: "23:00",
  primerTargetClaude: false, primerTargetCodex: true,
  primerAutoDeleteClaude: true, primerJitterEnabled: false, primerJitterSeconds: 0,
};
vi.mock("../../src/background/usage", () => ({
  readLocal: vi.fn(() => Promise.resolve({})), writeLocal: vi.fn(() => Promise.resolve()),
  enqueueUsageWork: vi.fn((fn: () => Promise<unknown>) => fn()),
}));
vi.mock("../../src/background/providerUsage", () => ({
  fetchChatgptSession: vi.fn(() => Promise.resolve({ origin: "https://chatgpt.com", token: "T", accountId: "A", plan: null })),
  getClaudeOrgId: vi.fn(() => Promise.resolve("ORG")), fetchJson: vi.fn(() => Promise.resolve({})),
}));

import * as primer from "../../src/background/primer";

function chromeStub() {
  const created: Array<{ name: string; when: number }> = [];
  const cleared: string[] = [];
  vi.stubGlobal("chrome", {
    action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
    storage: { sync: { get: (_d: unknown, cb: (s: Record<string, unknown>) => void) => cb(settings) } },
    alarms: {
      getAll: (cb: (a: Array<{ name: string }>) => void) => cb([{ name: "aleph-primer-sched-99:99" }, { name: "aleph-refresh-limits" }]),
      create: vi.fn((name: string, opts: { when: number }) => created.push({ name, when: opts.when })),
      clear: vi.fn((name: string) => cleared.push(name)),
    },
  });
  return { created, cleared };
}

describe("reconcilePrimerAlarms", () => {
  afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });
  it("clears stale primer alarms and creates the desired set (leaves non-primer alarms)", async () => {
    const { created, cleared } = chromeStub();
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
    vi.spyOn(primer, "readCodexWindow").mockResolvedValue({ active: true, resetAt: Date.now() + 1000 });
    const sendSpy = vi.spyOn(primer, "sendCodexPrimer");
    const r = await primer.runPrimer("codex");
    expect(sendSpy).not.toHaveBeenCalled();
    expect(r.reason).toMatch(/already active/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/primer-orchestration.spec.ts`
Expected: FAIL — `reconcilePrimerAlarms` not exported.

- [ ] **Step 3: Implement**

Append to `src/background/primer.ts`:

```ts
import { DEFAULTS } from "../shared/defaults";
import {
  desiredPrimerAlarmNames, computeAlarmWhen, nextSmartFire, PRIMER_ALARM_PREFIX,
} from "./primerSchedule";

type Settings = typeof DEFAULTS;

function getSettings(): Promise<Settings> {
  return new Promise((resolve) => chrome.storage.sync.get(DEFAULTS, (s) => resolve(s as Settings)));
}
function getAllAlarms(): Promise<chrome.alarms.Alarm[]> {
  return new Promise((resolve) => chrome.alarms.getAll((a) => resolve(a)));
}

/** Prime one target unless its window is already running. Records + returns the result. */
export async function runPrimer(target: PrimerTarget): Promise<PrimerRunResult> {
  const s = await getSettings();
  const win = target === "codex" ? await readCodexWindow() : await readClaudeWindow();
  if (win.active) {
    const r: PrimerRunResult = { at: Date.now(), ok: true, reason: "already active", windowResetAt: win.resetAt ?? undefined };
    await recordPrimerResult(target, r);
    return r;
  }
  const r = target === "codex"
    ? await sendCodexPrimer()
    : await sendClaudePrimer(s.primerAutoDeleteClaude);
  await recordPrimerResult(target, r);
  return r;
}

export async function runPrimerNow(target?: PrimerTarget): Promise<Record<string, PrimerRunResult>> {
  const s = await getSettings();
  const targets: PrimerTarget[] = target ? [target]
    : [...(s.primerTargetClaude ? ["claude"] as const : []), ...(s.primerTargetCodex ? ["codex"] as const : [])];
  for (const t of targets) await runPrimer(t);
  return getPrimerStatus();
}

/** Clear every aleph-primer* alarm and recreate the desired set (simple + robust vs partial diffs). */
export async function reconcilePrimerAlarms(): Promise<void> {
  const s = await getSettings();
  const existing = await getAllAlarms();
  for (const a of existing) if (a.name.startsWith(PRIMER_ALARM_PREFIX)) chrome.alarms.clear(a.name);
  const now = new Date();
  for (const name of desiredPrimerAlarmNames(s)) {
    chrome.alarms.create(name, { when: computeAlarmWhen(name, now, s, Math.random) });
  }
}

/** Fired from router's onAlarm for any aleph-primer* alarm. */
export async function handlePrimerAlarm(name: string): Promise<void> {
  const s = await getSettings();
  if (!s.primerEnabled) return;
  const now = new Date();
  if (name.startsWith(`${PRIMER_ALARM_PREFIX}-smart-`)) {
    const target = name.slice(`${PRIMER_ALARM_PREFIX}-smart-`.length) as PrimerTarget;
    await runPrimer(target);
    const win = target === "codex" ? await readCodexWindow() : await readClaudeWindow();
    const next = nextSmartFire(new Date(), win.resetAt ?? 0, s.primerOffDays, s.primerActiveHoursEnabled, s.primerActiveStart, s.primerActiveEnd);
    chrome.alarms.create(name, { when: next.fireAt });
    return;
  }
  // scheduled: run all enabled targets, then re-arm for the next occurrence.
  if (s.primerTargetClaude) await runPrimer("claude");
  if (s.primerTargetCodex) await runPrimer("codex");
  chrome.alarms.create(name, { when: computeAlarmWhen(name, now, s, Math.random) });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/primer-orchestration.spec.ts && npm run typecheck`
Expected: PASS; zero tsc errors.

> If the `vi.spyOn(primer, "readCodexWindow")` calls fail because the functions are called internally (not via the module object), refactor the internal calls in `runPrimer`/`handlePrimerAlarm` to reference module-level indirections, OR assert on the `fetch`/records instead. Keep the spy-friendly form: call `readCodexWindow()`/`sendCodexPrimer()` as top-level exports (already the case above).

- [ ] **Step 5: Commit**

```bash
git add src/background/primer.ts tests/unit/primer-orchestration.spec.ts
git commit -m "feat(primer): orchestration, alarm reconcile, and handlers"
```

---

### Task 10: Wire messages + router hooks

**Files:**
- Modify: `src/shared/messages.ts:41-51` (extend `PageToBackgroundMessage`)
- Modify: `src/background/router.ts` (onAlarm ~L112 region, storage.onChanged ~L120, onInstalled ~L95, onStartup ~L100, onMessage ~L130)
- Test: `tests/unit/background-alarm.spec.ts` (extend)

**Interfaces:**
- Consumes: `reconcilePrimerAlarms`, `handlePrimerAlarm`, `runPrimerNow`, `getPrimerStatus` (Tasks 7,9), `PRIMER_ALARM_PREFIX` (Task 4).
- Produces: two new wire messages `{ type: "aleph-primer-run-now"; target?: "claude" | "codex" }` and `{ type: "aleph-primer-status" }`.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/background-alarm.spec.ts`. First extend the `providerUsage` mock (it lacks the new exports) and add a `primer` mock near the other `vi.mock` calls:

```ts
vi.mock("../../src/background/primer", () => ({
  reconcilePrimerAlarms: vi.fn(() => Promise.resolve()),
  handlePrimerAlarm: vi.fn(() => Promise.resolve()),
  runPrimerNow: vi.fn(() => Promise.resolve({})),
  getPrimerStatus: vi.fn(() => Promise.resolve({})),
}));
```

Then add a test case inside the `describe`:

```ts
it("routes primer alarms and reconciles on install/startup/settings-change", async () => {
  const { reconcilePrimerAlarms, handlePrimerAlarm } = await import("../../src/background/primer");
  const onInstalled = makeEvent(); const onStartup = makeEvent();
  const onAlarm = makeEvent(); const onChanged = makeEvent();
  vi.stubGlobal("chrome", {
    runtime: { onInstalled, onStartup, onMessage: makeEvent(), onMessageExternal: makeEvent() },
    storage: { onChanged, sync: { get: vi.fn() } },
    alarms: { onAlarm, create: vi.fn() },
    commands: { onCommand: makeEvent() },
    action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
  });

  registerBackgroundListeners();
  onInstalled.fire();
  expect(reconcilePrimerAlarms).toHaveBeenCalled();

  onAlarm.fire({ name: "aleph-primer-sched-08:00" });
  expect(handlePrimerAlarm).toHaveBeenCalledWith("aleph-primer-sched-08:00");

  (reconcilePrimerAlarms as ReturnType<typeof vi.fn>).mockClear();
  onChanged.fire({ primerEnabled: { newValue: true } }, "sync");
  expect(reconcilePrimerAlarms).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/background-alarm.spec.ts`
Expected: FAIL — `handlePrimerAlarm` not called (router not wired yet).

- [ ] **Step 3: Extend the message union**

In `src/shared/messages.ts`, add to `PageToBackgroundMessage`:

```ts
  | { type: "aleph-antigravity-disconnect" }
  | { type: "aleph-primer-run-now"; target?: "claude" | "codex" }
  | { type: "aleph-primer-status" };
```

- [ ] **Step 4: Wire router.ts**

Add the import near the top of `src/background/router.ts` (with the other background imports):

```ts
import { reconcilePrimerAlarms, handlePrimerAlarm, runPrimerNow, getPrimerStatus } from "./primer";
import { PRIMER_ALARM_PREFIX } from "./primerSchedule";
```

In the existing `chrome.alarms.onAlarm.addListener((alarm) => { ... })`, add at the top of the callback:

```ts
    if (alarm.name.startsWith(PRIMER_ALARM_PREFIX)) { void handlePrimerAlarm(alarm.name); return; }
```

In the existing `onInstalled` and `onStartup` callbacks, add `void reconcilePrimerAlarms();`.

In the existing `chrome.storage.onChanged.addListener((changes, area) => { ... })`, after the sync guard, add:

```ts
    if (area === "sync" && Object.keys(changes).some((k) => k.startsWith("primer"))) void reconcilePrimerAlarms();
```

In the `chrome.runtime.onMessage` handler, alongside the other page handlers (before the `if (!sender.tab) return;` line), add:

```ts
    if (msg.type === "aleph-primer-run-now") {
      runPrimerNow(msg.target).then(sendResponse);
      return true;
    }
    if (msg.type === "aleph-primer-status") {
      getPrimerStatus().then(sendResponse);
      return true;
    }
```

- [ ] **Step 5: Run test + full suite**

Run: `npx vitest run tests/unit/background-alarm.spec.ts && npm run typecheck`
Expected: PASS; zero tsc errors.

- [ ] **Step 6: Commit**

```bash
git add src/shared/messages.ts src/background/router.ts tests/unit/background-alarm.spec.ts
git commit -m "feat(primer): wire messages and router hooks"
```

---

### Task 11: Settings UI

**Files:**
- Modify: `src/settings/settings.html` (add the Window Primer section markup)
- Create: `src/background/../settings/primerUi.ts` → `src/settings/primerUi.ts`
- Modify: `src/settings/index.ts` (call `loadPrimerUI()` + `bindPrimerEvents()`)
- Modify: `manifest.json` — **no permission change here** (alarms already granted; `scripting` only if Task 13 is needed)

**Interfaces:**
- Consumes: `DEFAULTS` primer keys; sends `{ type: "aleph-primer-run-now" }` / `{ type: "aleph-primer-status" }`.
- Produces: `loadPrimerUI(): void`, `bindPrimerEvents(): void`.

- [ ] **Step 1: Add HTML markup**

In `src/settings/settings.html`, add a new section (match the existing section markup — inspect a sibling like the focus/stream section for exact class names and copy them). Minimum required element IDs:

```html
<section class="card">
  <h2>Window Primer</h2>
  <p class="hint">Sends a real message and uses a small slice of your quota. Starts your 5-hour usage window early so it resets when you want it to.</p>

  <label class="row"><input type="checkbox" id="primerEnabled"> Enable Window Primer</label>

  <label class="row">Mode
    <select id="primerMode">
      <option value="scheduled">Scheduled (I set the times — lower footprint)</option>
      <option value="smart">Smart (keep a window always warm)</option>
    </select>
  </label>
  <p class="hint" id="primerSmartRisk" style="display:none">Smart mode sends ~5 automated requests/day per service — more bot-patterned than scheduled times; higher chance your account is throttled or asked to re-verify.</p>

  <div id="primerScheduledFields">
    <label class="row">Daily times (comma-separated, HH:MM) <input type="text" id="primerTimes" placeholder="08:00, 13:00"></label>
  </div>
  <div id="primerSmartFields" style="display:none">
    <label class="row"><input type="checkbox" id="primerActiveHoursEnabled"> Only keep warm during active hours</label>
    <label class="row">From <input type="time" id="primerActiveStart"> to <input type="time" id="primerActiveEnd"></label>
  </div>

  <label class="row">Off days (comma-separated 0=Sun … 6=Sat) <input type="text" id="primerOffDays" placeholder="5, 6"></label>
  <label class="row"><input type="checkbox" id="primerTargetClaude"> Prime Claude</label>
  <label class="row"><input type="checkbox" id="primerTargetCodex"> Prime Codex</label>
  <label class="row"><input type="checkbox" id="primerAutoDeleteClaude"> Auto-delete the Claude primer chat</label>
  <label class="row"><input type="checkbox" id="primerJitterEnabled"> Add random timing jitter</label>
  <label class="row">Jitter seconds (0–120) <input type="number" id="primerJitterSeconds" min="0" max="120"></label>

  <button id="primerTestBtn" type="button">Send test now</button>
  <p class="hint" id="primerStatus"></p>
</section>
```

- [ ] **Step 2: Create `src/settings/primerUi.ts`**

```ts
import { DEFAULTS } from "../shared/defaults";

const $ = (id: string) => document.getElementById(id);
const val = (id: string) => ($(id) as HTMLInputElement | null)?.value ?? "";
const checked = (id: string) => ($(id) as HTMLInputElement | null)?.checked ?? false;

function parseList(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}
function updateModeVisibility(mode: string) {
  const smart = mode === "smart";
  const s = $("primerSmartFields"); if (s) s.style.display = smart ? "" : "none";
  const sc = $("primerScheduledFields"); if (sc) sc.style.display = smart ? "none" : "";
  const risk = $("primerSmartRisk"); if (risk) risk.style.display = smart ? "" : "none";
}

export function loadPrimerUI(): void {
  chrome.storage.sync.get(DEFAULTS, (s) => {
    (["primerEnabled", "primerActiveHoursEnabled", "primerTargetClaude", "primerTargetCodex", "primerAutoDeleteClaude", "primerJitterEnabled"] as const)
      .forEach((k) => { const el = $(k) as HTMLInputElement | null; if (el) el.checked = s[k]; });
    (["primerMode", "primerActiveStart", "primerActiveEnd", "primerJitterSeconds"] as const)
      .forEach((k) => { const el = $(k) as HTMLInputElement | null; if (el) el.value = String(s[k]); });
    const times = $("primerTimes") as HTMLInputElement | null; if (times) times.value = (s.primerTimes as string[]).join(", ");
    const off = $("primerOffDays") as HTMLInputElement | null; if (off) off.value = (s.primerOffDays as number[]).join(", ");
    updateModeVisibility(s.primerMode as string);
  });
  refreshStatus();
}

function refreshStatus() {
  chrome.runtime.sendMessage({ type: "aleph-primer-status" }, (res: Record<string, { at: number; ok: boolean; reason?: string }> | undefined) => {
    const el = $("primerStatus"); if (!el || !res) return;
    el.textContent = Object.entries(res).map(([t, r]) =>
      `${t}: ${r.ok ? "ok" : "FAILED — " + (r.reason || "error")}`).join("   ·   ") || "no runs yet";
  });
}

export function bindPrimerEvents(): void {
  const save = (k: string, v: unknown) => chrome.storage.sync.set({ [k]: v });
  (["primerEnabled", "primerActiveHoursEnabled", "primerTargetClaude", "primerTargetCodex", "primerAutoDeleteClaude", "primerJitterEnabled"] as const)
    .forEach((k) => $(k)?.addEventListener("change", () => save(k, checked(k))));
  $("primerMode")?.addEventListener("change", () => { const v = val("primerMode"); save("primerMode", v); updateModeVisibility(v); });
  $("primerActiveStart")?.addEventListener("change", () => save("primerActiveStart", val("primerActiveStart")));
  $("primerActiveEnd")?.addEventListener("change", () => save("primerActiveEnd", val("primerActiveEnd")));
  $("primerJitterSeconds")?.addEventListener("change", () => save("primerJitterSeconds", Math.max(0, Math.min(120, Number(val("primerJitterSeconds")) || 0))));
  $("primerTimes")?.addEventListener("change", () => save("primerTimes", parseList(val("primerTimes"))));
  $("primerOffDays")?.addEventListener("change", () => save("primerOffDays", parseList(val("primerOffDays")).map(Number).filter((n) => n >= 0 && n <= 6)));
  $("primerTestBtn")?.addEventListener("click", () => {
    const el = $("primerStatus"); if (el) el.textContent = "sending…";
    chrome.runtime.sendMessage({ type: "aleph-primer-run-now" }, () => refreshStatus());
  });
}
```

- [ ] **Step 3: Wire into `src/settings/index.ts`**

Import and call alongside the existing `loadUI()`/`bindEvents()`:

```ts
import { loadPrimerUI, bindPrimerEvents } from "./primerUi";
// ...wherever loadUI()/bindEvents() are called:
loadPrimerUI();
bindPrimerEvents();
```

- [ ] **Step 4: Build + typecheck**

Run: `npm run build && npm run typecheck`
Expected: build succeeds (bundles `primerUi`); zero tsc errors.

- [ ] **Step 5: Commit**

```bash
git add src/settings/settings.html src/settings/primerUi.ts src/settings/index.ts
git commit -m "feat(primer): settings UI with modes, jitter, off-days, and test button"
```

---

### Task 12: Live Claude-POST capture (validation gate)

**Files:** none (manual validation producing a decision + notes appended to the design doc).

This confirms whether Claude's completion POST works from the background as-is, needs the DNR `Origin`/`Referer` rewrite, or needs the Task 13 page-context fallback.

- [ ] **Step 1: Capture the real request**

In Chrome, logged into claude.ai: open DevTools → Network, filter `completion`, send a one-word message in any chat. Inspect the `POST .../completion` request:
- Record the exact request headers (look specifically for `anthropic-anti-csrftoken-a2z`, `anthropic-client-sha`, `anthropic-client-version`, any `x-*` token).
- Record whether `Origin`/`Referer` are present and their values.

- [ ] **Step 2: Test the background path**

Load the built extension (Task 14 reload flow). On a claude.ai tab, open the service-worker console (chrome://extensions → Service worker) and run:

```js
chrome.runtime.getBackgroundPage; // n/a in MV3 — instead trigger via the settings "Send test now" with only Claude enabled
```

Enable **only** Claude, click **Send test now**, and watch the SW console + Network for the `create`/`completion`/`delete` calls. Note the HTTP status.

- [ ] **Step 3: Decide + record**

- **If completion returns 2xx:** background path works. Append to `docs/superpowers/specs/2026-07-11-window-primer-design.md` a line under the Claude caveat: "Live capture <date>: background POST returns 2xx, no fallback needed." **Skip Task 13.**
- **If it 403s with an `Origin`/`Referer` mismatch (no anti-CSRF token seen in Step 1):** add a `declarativeNetRequest` rule rewriting `Origin`/`Referer` to `https://claude.ai` for `claude.ai/api/*` POSTs from the extension, then re-test. Record the outcome.
- **If it 403s AND Step 1 showed a required `anthropic-anti-csrftoken-a2z`:** the background cannot compute it → **do Task 13 (fallback).**

- [ ] **Step 4: Commit the note**

```bash
git add docs/superpowers/specs/2026-07-11-window-primer-design.md
git commit -m "docs(primer): record live Claude-POST capture result"
```

---

### Task 13 (conditional): Claude page-context fallback

**Do this task only if Task 12 concluded the background POST is gated.**

**Files:**
- Modify: `manifest.json` (add `"scripting"` to `permissions`)
- Modify: `src/background/primer.ts` (`sendClaudePrimer` → try background, on 403 run the three fetches via `chrome.scripting.executeScript` in a claude.ai tab's MAIN world)
- Test: `tests/unit/primer-send.spec.ts` (add a 403→fallback case)

**Interfaces:**
- Consumes: `chrome.scripting.executeScript`, `chrome.tabs`.
- Produces: `sendClaudePrimerViaTab(orgId, greeting, autoDelete): Promise<PrimerRunResult>` used as the fallback branch.

- [ ] **Step 1: Add the permission**

In `manifest.json`, change:
```json
"permissions": ["storage", "activeTab", "identity", "cookies", "alarms", "scripting", "declarativeNetRequestWithHostAccess"],
```

- [ ] **Step 2: Write the failing test**

Add to `tests/unit/primer-send.spec.ts`:

```ts
it("falls back to a claude.ai tab when the background POST is 403", async () => {
  const { getClaudeOrgId } = await import("../../src/background/providerUsage");
  (getClaudeOrgId as ReturnType<typeof vi.fn>).mockResolvedValue("ORG");
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, status: 403, headers: new Headers(), text: () => Promise.resolve("") })));
  const executeScript = vi.fn(() => Promise.resolve([{ result: { ok: true, resetAt: 123 } }]));
  vi.stubGlobal("chrome", {
    action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
    scripting: { executeScript },
    tabs: { query: (_q: unknown, cb: (t: Array<{ id: number }>) => void) => cb([{ id: 7 }]) },
  });
  const { sendClaudePrimer } = await import("../../src/background/primer");
  const r = await sendClaudePrimer(true, () => 0);
  expect(executeScript).toHaveBeenCalled();
  expect(r.ok).toBe(true);
});
```

- [ ] **Step 3: Implement the fallback**

In `sendClaudePrimer`, when the create/completion returns 403, call `sendClaudePrimerViaTab`. Add:

```ts
function queryClaudeTab(): Promise<number | null> {
  return new Promise((resolve) => {
    try { chrome.tabs.query({ url: "https://claude.ai/*" }, (tabs) => resolve(tabs[0]?.id ?? null)); }
    catch { resolve(null); }
  });
}

async function sendClaudePrimerViaTab(orgId: string, greeting: string, autoDelete: boolean): Promise<PrimerRunResult> {
  const at = Date.now();
  const tabId = await queryClaudeTab();
  if (tabId == null) return { at, ok: false, reason: "open a claude.ai tab to prime" };
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId }, world: "MAIN",
    args: [orgId, greeting, autoDelete, Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC"],
    func: async (org: string, msg: string, del: boolean, tz: string) => {
      const base = `/api/organizations/${org}/chat_conversations`;
      const uuid = crypto.randomUUID();
      const j = (u: string, m: string, b?: unknown) => fetch(u, { method: m, headers: { "Content-Type": "application/json" }, body: b === undefined ? undefined : JSON.stringify(b), credentials: "include" });
      const c = await j(base, "POST", { name: "", uuid });
      if (!c.ok) return { ok: false, reason: "create " + c.status };
      const comp = await j(`${base}/${uuid}/completion`, "POST", { prompt: msg, timezone: tz, attachments: [], files: [] });
      if (!comp.ok) return { ok: false, reason: "completion " + comp.status };
      await comp.text();
      if (del) { try { await j(`${base}/${uuid}`, "DELETE", uuid); } catch { /* best effort */ } }
      return { ok: true };
    },
  }) as unknown as Array<{ result: { ok: boolean; reason?: string } }>;
  return { at, ok: !!result?.ok, reason: result?.reason };
}
```

And change the `create`/`comp` 403 branches in `sendClaudePrimer` to:
```ts
  if (create.status === 403) return sendClaudePrimerViaTab(orgId, greeting, autoDelete);
```
(compute `greeting` once with `pickGreeting(rng)` before the create call so both paths use the same text).

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run tests/unit/primer-send.spec.ts && npm run typecheck`
Expected: PASS; zero tsc errors.

- [ ] **Step 5: Commit**

```bash
git add manifest.json src/background/primer.ts tests/unit/primer-send.spec.ts
git commit -m "feat(primer): claude.ai page-context fallback for gated POST"
```

---

### Task 14: Build, reload, and end-to-end verification

**Files:** none (manual verification per CLAUDE.md §7 + the reload flow).

- [ ] **Step 1: Full gate**

Run: `npm run check`
Expected: typecheck + lint + test + build all pass.

- [ ] **Step 2: Reload the extension**

`npm run build`, then from a Claude/ChatGPT tab run the `aleph-reload` snippet (CLAUDE.md "Reloading the extension"), wait ~2s, refresh, and confirm `document.documentElement.getAttribute('data-aleph-build')` matches the new stamp.

- [ ] **Step 3: Verify scheduled mode**

In Settings: enable primer, Scheduled mode, set a time 1–2 minutes ahead, Codex only, jitter off. Wait for the alarm. In the SW console confirm a `POST /backend-api/codex/responses` fired and `chrome://extensions` shows no errors. Confirm `chrome.storage.local` `primer_status.codex.ok === true`.

- [ ] **Step 4: Verify Test button + Claude**

Enable Claude, click **Send test now**. Confirm the create/completion/delete calls, that the throwaway chat does **not** linger in the claude.ai sidebar (auto-delete), and that `primer_status.claude.ok === true`. Verify `readClaudeWindow()` shows `five_hour.resets_at ≈ now+5h` (tighten the `wham/usage` field in Task 8 if Codex's read was wrong).

- [ ] **Step 5: Verify failure surfacing**

Sign out of ChatGPT in the browser, click **Send test now**. Confirm the toolbar shows the `!` badge and Settings shows `codex: FAILED — signed out…`. Open the popup/settings status (calls `getPrimerStatus`) and confirm the `!` clears.

- [ ] **Step 6: Regression sweep**

Confirm the 20-minute usage-refresh alarm still fires (unrelated alarm still works), themes/BiDi/focus still apply (no console errors on Claude/ChatGPT/Gemini), and `npm run check` is still green.

- [ ] **Step 7: Final commit / PR**

```bash
git add -A && git commit -m "test(primer): manual E2E verification notes"
```

Open a PR from `feature/window-primer` when the user approves.

---

## Self-Review

**Spec coverage** (each design section → task):
- Data model → Task 1. Modes (scheduled/smart) → Tasks 3,4,9. Off-days + active-hours → Tasks 2,3. Skip-if-active → Task 9. Jitter (seconds/toggle) + greeting roster → Tasks 2,4,8. Codex send → Tasks 5,8. Claude send + auto-delete → Tasks 5,8. Verify window started → Tasks 5,8 (Codex headers; Claude usage read). Failure signal + status → Task 7. Router/messages → Task 10. Settings UI (+ disclosure + smart risk note) → Task 11. Claude background caveat + fallback → Tasks 12,13. Tests → every task. ToS mitigations (jitter/off-days/opt-in/disclosure) → Tasks 1,2,11.
- **Gap check:** the `reconcileAlarms` pure-diff named in the spec was replaced by "clear-all + create-desired" in Task 9 (simpler, handles off-day changes correctly); the pure units became `desiredPrimerAlarmNames` + `computeAlarmWhen`. This is an intentional refinement — noted here so the spec and plan agree.

**Placeholder scan:** No "TBD/handle edge cases/similar to Task N". The one runtime unknown (`wham/usage` field name, Task 8) has a defensive default + a Task 14 tightening step, not a placeholder. The Claude fallback (Task 13) is explicitly conditional on Task 12's measured result.

**Type consistency:** `PrimerTarget` ("claude"|"codex") used consistently. `PrimerRunResult` shape identical across Tasks 7–9. `HttpRequest` from Task 5 consumed by Task 8's `doFetch`. `computeAlarmWhen`/`desiredPrimerAlarmNames` signatures match between Task 4 (def) and Task 9 (use). Message strings `aleph-primer-run-now`/`aleph-primer-status` identical in messages.ts, router, and primerUi.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-11-window-primer.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
