# Window Primer — scheduled / smart usage-window warm-up — design

Date: 2026-07-11
Status: design in review — Codex + Claude send-paths CONFIRMED (Codex headless-feasible; Claude feasible-with-caveats, page-context fallback specified)

## Problem / motivation

Claude and OpenAI Codex both meter usage in a rolling ~5-hour window that **starts
on the first request after a reset**. If that first request is the one you send
when you sit down to work, the window is pinned to that moment and your *next*
reset is a full 5h away — burn the quota early and you wait up to 5h for a fresh
bucket.

Two ways to do better:
- **Start the window earlier** at a chosen time so the reset lands when you want it.
- **Keep a window always warm** so a fresh bucket is never far off. With windows
  tiling back-to-back, arriving at a random moment puts the next reset uniform on
  `[0, 5h]` → **~2.5h average** vs 5h for a cold start, and you arrive to a
  near-full current bucket too.

Aleph already authenticates to both backends from the background service worker to
**read** usage (`src/background/providerUsage.ts`). This feature extends that to
**write** one tiny "hi" per window, on a schedule, via background API replay — never
the composer, and with no foreground tab except on Claude's fallback path.

## Goal

Let the user schedule a minimal primer message to Claude and/or the Codex 5h
window, in two modes (fixed daily times or smart always-warm), bounded by off-days
and active hours, cleaning up after itself, and surfacing failures.

## Non-goals / scope

- **Not** ChatGPT-chat priming — the user chose the Codex agent window
  specifically (separate window under `/backend-api/wham`). Addable later via the
  `conversation/init` surface.
- **Not** Gemini.
- **Not** composer automation — Aleph deliberately never writes to the host
  composer (ProseMirror/Quill reconcile-and-revert feedback loop, commit c7bb26f).
  Send is via API replay (never composer typing).
- **No** per-service schedules or per-service modes in v1 — one shared time list,
  one global mode (judgment calls ① / ④). Easy to split later.

## Modes

- **Scheduled** — user picks one or more local clock times; each fires a primer for
  every enabled target. Best when your hours are predictable (align the reset to
  your day).
- **Smart** — keep each target's window always warm: when a target's window has
  lapsed (limit slot empty), prime immediately to start the next one; re-arm to that
  window's own reset time. Best when your hours are unpredictable (never more than
  ~2.5h from fresh, zero config).

Both modes skip on **off-days**. Smart is additionally bounded to **active hours**
(scheduled mode uses the explicit times the user set, so active-hours doesn't
further restrict it). **"Skip if already active" (judgment call ②) is the shared
primitive** — never prime a window that is already running.

## Data model (`chrome.storage.sync` via `DEFAULTS`)

```ts
primerEnabled: false,                              // master opt-in
primerMode: "scheduled" as "scheduled" | "smart",
primerTimes: [] as string[],                       // ["08:00","13:00"] local; scheduled mode
primerOffDays: [] as number[],                     // JS getDay(): 0=Sun … 6=Sat; no primers these days
primerActiveHoursEnabled: false,                   // when false, smart tiles 24/7
primerActiveStart: "07:00",                        // smart-mode lower bound (local HH:MM)
primerActiveEnd: "23:00",                           // smart-mode upper bound
primerTargetClaude: true,
primerTargetCodex: true,
primerAutoDeleteClaude: true,                      // Codex needs none (store:false persists nothing)
primerJitterEnabled: true,                         // toggle the anti-bot timing jitter
primerJitterSeconds: 120,                          // customizable spread (0..120): random 0..N s added to every fire
```

Notes:
- Array/enum defaults **must** carry explicit annotations (`as string[]`,
  `as number[]`, the `primerMode` union) or `Settings = typeof DEFAULTS` infers
  `never[]` / over-narrow literals.
- `filterToDefaults` already guards file import + cloud sync for any key in
  `DEFAULTS` — new keys need no extra export/import or sync wiring.
- Runtime status is **device-local and must not sync** → separate
  `chrome.storage.local` key `primerStatus` (component 5), never added to `DEFAULTS`.

## Components

### 1. Reuse existing auth — export in place from `providerUsage.ts` (modified)

Do not reimplement session/cookie auth. Minimal-churn option: add `export` to the
existing module-private `fetchChatgptSession` (→ `{origin, token, accountId, plan}`),
`getClaudeOrgId` (→ `orgId`), `getCookie`, and `fetchJson` in
`src/background/providerUsage.ts`, and import them from `primer.ts`. If the primer's
needs grow later, extract a `src/background/providerAuth.ts`; not required for v1.

### 2. `src/background/primerSchedule.ts` (new) — pure helpers (schedule, jitter, greeting), unit-tested

No `chrome`/DOM access. All date/gating logic plus the two RNG-driven helpers:
- `isOffDay(date, offDays): boolean`
- `withinActiveHours(date, start, end): boolean` — handles `start > end` midnight wrap.
- `nextScheduledOccurrence(time, from, offDays): number` — next epoch-ms for a daily
  `HH:MM`, skipping off-days; handles next-day rollover and local DST.
- `nextSmartFire(from, resetAt, offDays, activeHoursEnabled, start, end): { fireAt: number; primeNow: boolean }`
  — window lapsed **and** inside an allowed slot → `primeNow: true`; otherwise defer
  `fireAt` to the next allowed opening (or `resetAt`, whichever is later).
- `reconcileAlarms(settings, existingAlarmNames): { create: {name, when}[]; clear: string[] }`
  — pure diff of desired vs existing alarms.
- `applyJitter(fireAt, enabled, jitterSeconds, rng): number` — when `enabled`, adds
  `rng() * jitterSeconds` (additive, 0..N **seconds**, N clamped to 0..120) on top of a
  computed base fire time so the cadence isn't machine-perfect; when disabled returns
  `fireAt` unchanged. The RNG is **injected** so every function above stays deterministic
  under test; jitter is a non-deterministic step, applied last, and never moves a smart
  fire before its `resetAt`.
- `pickGreeting(rng): string` — returns a uniformly-random member of the
  `PRIMER_GREETINGS` roster (~15 short innocuous greetings: `hi`, `hello`, `hey`,
  `hey there`, `hi there`, `hiya`, `howdy`, `yo`, `morning`, `sup`, `hey!`, `hello!`,
  `ping`, `you around?`, `just checking in`). Injected RNG → unit-testable. Its return
  is the message text for both send paths, so no two primers are byte-identical.

### 3. `src/background/primer.ts` (new) — define-only at import (no top-level listeners)

Exports functions invoked from `router.ts`:
- `reconcilePrimerAlarms()` — reads settings, runs `reconcileAlarms`, applies via
  `chrome.alarms.create/clear`. Called on startup, install, and any `primer*`
  settings change.
- `handlePrimerAlarm(name)` — dispatched from the existing `onAlarm` when
  `name.startsWith("aleph-primer")`. Scheduled alarm → run all enabled targets, then
  re-arm that time for its next occurrence (`nextScheduledOccurrence`, skipping
  off-days). Smart alarm (`aleph-primer-smart-<target>`) → run that target, then
  re-arm to its new reset (or backoff on failure).
- `runPrimer(target)` — gate check → read current window state → **skip if already
  active** (record, re-arm) → else send (Codex/Claude path) → verify window started →
  Claude: delete conversation if `primerAutoDeleteClaude` → record status → on failure
  record + raise the failure signal. **Serialized per target** (reuse the
  `enqueueUsageWork`-style single-flight queue from `usage.ts`) so overlapping alarm
  fires never double-send.
- `runPrimerNow(target?)` — the Settings "Send test now" entry point.
- `getPrimerStatus()` — returns `primerStatus` for the UI.

Alarm names: scheduled `aleph-primer-sched-<HH:MM>` (targets share times); smart
`aleph-primer-smart-claude` / `aleph-primer-smart-codex` (windows are independent).

### 4. Send paths (background API replay)

**Codex — CONFIRMED** (source: `openai/codex` Rust client; feasibility spike):
- `POST https://chatgpt.com/backend-api/codex/responses`
- Headers: `Authorization: Bearer <token>` + `ChatGPT-Account-ID: <accountId>` (both
  already fetched today for `/wham/usage`), `Content-Type: application/json`,
  `Accept: text/event-stream`, plus recommended `originator: codex_cli_rs`.
- Minimal body:
  ```json
  { "model": "gpt-5-codex-mini",
    "instructions": "You are a helpful assistant.",
    "input": [{"type":"message","role":"user","content":[{"type":"input_text","text":"hi"}]}],
    "tool_choice": "auto", "parallel_tool_calls": false, "reasoning": null,
    "store": false, "stream": true, "include": [] }
  ```
  `instructions` must be non-empty; `store: false` is mandatory for the ChatGPT
  backend → **nothing is persisted, no cleanup needed**.
- Model slug drifts: default `gpt-5-codex-mini`; on 404 resolve the cheapest via
  `GET /backend-api/codex/models` (same auth).
- Drain the SSE response (`await res.text()`). Verify via response headers
  `x-codex-primary-{used-percent,window-minutes,reset-at}`, or re-read
  `/backend-api/wham/usage`.
- **Feasibility: FEASIBLE** — identical auth + Cloudflare zone to today's working
  `wham/usage` GET; the run endpoint attaches no attestation / proof-of-work / Arkose
  (that machinery is opt-in and WebSocket-only). Fallback if Cloudflare ever
  challenges the POST: fire the same `fetch` from a `chatgpt.com` content-script /
  page context (first-party origin + `cf_clearance`).

**Claude — CONFIRMED, FEASIBLE-WITH-CAVEATS** (sources: maintained claude.ai clients
st1vms / Adithyan / KoushikNavuluri; the 5h "pre-warm" is a documented technique).
All three requests are **cookie-authenticated** — the browser's `sessionKey`,
auto-attached by `credentials: "include"`; **no bearer token**, and the maintained
clients send **no** CSRF header. Reuse `getClaudeOrgId()` verbatim.
- Create: `POST https://claude.ai/api/organizations/{orgId}/chat_conversations`
  `{ name: "", uuid: <crypto.randomUUID()> }` — client generates the uuid; the server
  adopts it as `{convUuid}`.
- Send (starts the window): `POST .../chat_conversations/{convUuid}/completion`
  `{ prompt: "hi", timezone: "Etc/UTC", attachments: [], files: [] }`. **Omit `model`**
  — every completion starts the window regardless, and omission avoids a stale slug
  (server uses the account default). SSE response — drain to `message_stop` (or abort
  after first byte; the window is charged on acceptance). The *completion*, not the
  create, starts the window → create→complete is the minimal order.
- Delete: `DELETE .../chat_conversations/{convUuid}` (body = JSON-quoted uuid, or
  empty) — auto-delete.
- Verify: re-read `GET /api/organizations/{orgId}/usage`; the extension's existing
  `normalizeClaudeUsage()` already parses `five_hour.resets_at` — null/absent before,
  ≈ now+5h after → proves the window started and yields the reset time to display. No
  new endpoint.
- **Caveat (background POST):** a background `fetch` sends `Origin: chrome-extension://<id>`;
  if claude.ai validates `Origin`/`Referer` on POST it may 403 (GET is a "safe" method,
  so today's working reads don't fully prove POST). First mitigation: rewrite
  `Origin`/`Referer` to `https://claude.ai` via `declarativeNetRequest` (the same DNR
  header-rewrite the extension already uses for Antigravity;
  `declarativeNetRequestWithHostAccess` is already granted). DNR can't forge
  `Sec-Fetch-*`, and a POST-only `anthropic-anti-csrftoken-a2z` could in principle be
  enforced (unverified past the research cutoff) — hence the shared fallback below.

**Send transport — background-first, page-context fallback.** Try the headless
background `fetch` first (Codex is headless today; Claude is headless if `Origin`/CSRF
don't gate it). On a 403 / non-SSE HTML challenge, fall back to running the same
fetches from a **page context** — a MAIN-world `chrome.scripting.executeScript` into an
existing claude.ai / chatgpt.com service tab (or a briefly-opened background tab) —
which inherits the page's real origin, `Sec-Fetch-Site: same-origin`, and any
window-computed token automatically. **First implementation step:** one live devtools
capture of a real claude.ai completion POST to settle whether the background path needs
the DNR rewrite, the fallback, or neither. The fallback adds the `scripting` permission
and a transient tab; Codex needs no tab, and Claude uses one only if its background
path is gated.

**Anti-fingerprint.** Successive primers pick a random greeting from the
`PRIMER_GREETINGS` roster (~15 entries) and carry the timing jitter (0..120 s,
toggleable — component 2), so they are neither byte-identical nor clockwork-regular.

**Live validation (2026-07-11, logged-in claude.ai session).**
- Claude `create` → **201**, `delete` → **204** with cookie auth + the active org
  (`lastActiveOrg` cookie). A **pristine native `fetch`** (no app patch) also 201s →
  **no anti-CSRF token is required**. An initial 403 "Invalid authorization for
  organization" was a *probe bug* (used `orgs[0]` instead of the active org, and the
  account has 2 orgs); `getClaudeOrgId()` already reads `lastActiveOrg`, so the primer
  targets the right org. Request builders confirmed correct.
- `GET /organizations/{org}/usage` returns `five_hour.resets_at` as an ISO string with
  offset — exactly the field `readClaudeWindow` parses; skip-if-active verified against
  a live active window.
- **Unresolved (not testable from a page context):** whether claude.ai accepts the
  background service worker's `Origin: chrome-extension://<id>` on POST. Handled by the
  send-transport decision below (MAIN-world fallback and/or DNR Origin rewrite).

### 5. Failure signal + status — `chrome.storage.local` `primerStatus`

Shape: `{ [target]: { at, ok, reason?, windowResetAt?, usedPercent? } }`. A failed
last-run (signed out, 401/403, Cloudflare challenge, model 404 after retry) raises a
visible toolbar-**badge** failure flag (red; coordinated with the existing
feature-count badge so a failure takes precedence) and shows a per-target status line
in popup + settings. **No new `notifications` permission in v1** — OS notifications
are an optional follow-on. Failures are non-fatal; alarms re-arm regardless; smart
mode retries with capped backoff (e.g. +15 min).

### 6. `src/background/router.ts` (modified)

All hooks live inside the existing `registerBackgroundListeners()` listeners — no new
top-level listener, preserving the MV3 first-sync-turn rule:
- Existing `chrome.alarms.onAlarm`: `if (alarm.name.startsWith("aleph-primer")) return void handlePrimerAlarm(alarm.name);`
- Existing `chrome.storage.onChanged`: when any changed key starts with `primer`,
  `void reconcilePrimerAlarms()`.
- Existing `onInstalled` + `onStartup`: `void reconcilePrimerAlarms()`.
- `onMessage` type-switch: `aleph-primer-run-now` → `runPrimerNow` (respond with
  result); `aleph-primer-status` → `getPrimerStatus`.

### 7. `src/shared/messages.ts` (modified)

Add wire types `PrimerRunNowMessage { type: "aleph-primer-run-now"; target?: "claude" | "codex" }`
and `PrimerStatusMessage { type: "aleph-primer-status" }` to the page→background union
plus their response shapes. Types describe the wire only.

### 8. Settings UI — `src/settings/primerUi.ts` (new), wired in `src/settings/index.ts`

New "Window Primer" section built from the existing `src/settings/controls.ts`
primitives: master toggle · mode radio (Scheduled / Smart) · time-list add/remove
(Scheduled) · active-hours enable + start/end (Smart) · off-days weekday multiselect
(both) · Claude / Codex checkboxes · auto-delete toggle · jitter toggle + seconds
field (0–120) · **"Send test now"** button
(→ `aleph-primer-run-now`) · per-target last-run status line · one honest disclosure
line: *"Sends a real message and uses a small slice of your quota."* When **Smart**
is selected, an inline **risk note**: *"Smart mode sends ~5 automated requests/day per
service — more bot-patterned than scheduled times; higher chance your account is
throttled or asked to re-verify."* Scheduled is presented as the lower-footprint default.

## Data flow

Settings change / startup → `reconcilePrimerAlarms()` diffs desired vs existing
`chrome.alarms` → alarm fires → `handlePrimerAlarm` → `runPrimer(target)` (gate →
skip-if-active → send via reused auth → verify → Claude delete → record status) →
re-arm (scheduled: tomorrow; smart: next reset / backoff) → UI reads `primerStatus`;
"Send test now" runs on demand.

## Testing (tests ship with the change — repo policy)

- `tests/unit/primer-schedule.spec.ts` (new): `isOffDay`; `withinActiveHours`
  (incl. midnight wrap); `nextScheduledOccurrence` (DST, off-day skip, next-day
  rollover); `nextSmartFire` (lapsed vs active window, active-hours deferral,
  off-day deferral); `applyJitter` (disabled = identity; enabled adds 0..N s within
  bounds via a seeded RNG, never before `resetAt`); `pickGreeting` (always a roster
  member; covers the set under a seeded RNG); `reconcileAlarms` diffing. Highest-value
  pure units.
- `tests/unit/primer-request.spec.ts` (new): Codex + Claude request builders assert
  exact endpoint / headers / body (mandatory `store:false`, non-empty `instructions`,
  bearer+account-id vs cookie assumptions); response → window-status parsing.
- Live sending needs real auth → verified manually via the "Send test now" button
  (documented, not faked). Per repo memory, Settings-page UI is automation-blocked →
  manual glance for the new section.
- CI gates (`typecheck` + `lint` + `test` + `build`) apply.

## Risks / accepted trade-offs

- Priming spends a small slice of the user's **own** quota by design (one tiny turn
  per window) — opt-in, disclosed in the UI.
- Smart 24/7 tiling sends ~5 primers/day/target on idle days and can fire overnight —
  mitigated by off-days + active-hours.
- Backend request shapes drift (model slugs; possible anti-CSRF) → resolve model via
  API; confirm Claude's POST headers with one live devtools capture at implementation
  start; page-context-fetch fallback if a background POST is ever gated.
- Requires the user to be logged in to each service in Chrome (cookies/token present);
  otherwise the primer records "signed out" and raises the failure signal.
- **ToS / account-safety — the material product risk.** This drives the *consumer*
  claude.ai / chatgpt.com internal endpoints on a schedule — outside the official APIs
  and generally disallowed by consumer terms. The exposure is **per-user and
  self-contained**: each install acts only under its own user's logged-in session
  against their own account — no shared jeopardy across users, nothing centrally flagged
  about "the extension." The realistic downside is to that one account:
  clockwork-regular requests can plausibly earn a throttle or an extra captcha/re-verify
  challenge (outright suspension is uncommon for light personal automation). Smart mode's
  ~5 requests/day/target is more bot-patterned than a couple of scheduled pings, so it
  carries a visible in-UI risk note. Mitigations: opt-in + off by default, low frequency,
  additive timing **jitter** + greeting rotation so the cadence isn't machine-perfect,
  one tiny "hi", honest disclosure, and (for Claude) the same-origin page-context path
  reads as normal app traffic. A knowing trade-off on the user's own account, not a
  technical blocker.

## Out of scope / future

- ChatGPT-chat and Gemini priming.
- Per-service schedules / per-service modes.
- OS notifications (needs the `notifications` permission).
- Active-hours bound for scheduled mode (explicit times already imply intent).
