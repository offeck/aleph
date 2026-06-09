# Cloud Sync (schema v2)

Optional Google-sign-in sync, implemented in `src/background/sync.ts` (orchestration)
and `src/background/syncSchema.ts` (pure helpers, unit-tested). Firebase project:
`aleph-ai-chat-styler`, Firestore `(default)` in `nam5`, accessed through the
vendored compat SDK from the MV3 service worker. No conversation text is ever
read, stored, or synced — only aggregate usage metrics, plan detections, and
settings.

## Firestore layout

Everything lives under `users/{uid}`; `firestore.rules` denies anything else.

| Path | Contents |
|---|---|
| `usage/{YYYY-MM-DD}` | **Legacy** combined usage days (pre-v2 clients wrote these with max-merge semantics). Frozen baseline: v2 clients write it exactly once (the migration *seal*), then never again. |
| `usageRollups/{deviceId}_{YYYY-MM-DD}` | One doc per device per day: `{ schemaVersion, deviceId, date, tzOffsetMinutes, appVersion, platforms: { claude/chatgpt/gemini: counters }, updatedAt }`. Written with full `set()` — the local day doc is the source of truth, so rewrites are idempotent. Counters from different devices **add**. |
| `meta/settings2` | `{ schemaVersion, values, updatedAtByKey, updatedAt }` — DEFAULTS-filtered settings with per-key epoch-ms stamps (last-write-wins per key). |
| `meta/settings` | Legacy flat settings doc. Read once as an upgrade fallback (stamped 0), never written by v2 clients. |
| `meta/subscriptions` | Per-platform plan detections. Merge rule: `manualOverride` wins, then newer `detectedAt`. |

`tzOffsetMinutes` is the raw JavaScript `Date#getTimezoneOffset()` — **positive
means behind UTC** (e.g. New York is `300`/`240`; Jerusalem is `-120`/`-180`).
Hour buckets (`platforms.*.hours`, `platforms.*.sends.byHour`) are in the
device's **local time**; use `tzOffsetMinutes` to normalize across users.

## Multi-device model

- Each device has a persistent random ID (`aleph_device_id` in
  `chrome.storage.local` — never in `storage.sync`).
- A device pushes only its **own** local day docs, as full-set rollups.
- The dashboard shows `own local day` **ADD** `aleph_remote_usage` cache, where
  `cache[date] = legacy baseline + Σ other devices' rollups`
  (`buildRemoteUsageCache`). Every UI/remark read goes through
  `readCombinedUsageDays()` in `src/background/usage.ts`.
- Cache refresh: 14-day windowed pull, 5-min throttled, triggered from the
  `insights-get-summary` handler (popup/dashboard open) and the 20-minute
  alarm. Full history rebuild happens at sign-in and on `aleph-sync-now`.

## Migration from v1 ("seal before reset")

Pre-v2, every synced device's local docs held the **max-merged union** of all
devices (the old full sync wrote merged results back to local), so local data
cannot be claimed as one device's own. At the first signed-in boot of v2
(`ensureMigrated` → `decideAdoption`):

- **Cloud has legacy history** → *seal-and-adopt*: run the legacy max-merge one
  final time so cloud legacy ⊇ local union (chunked batches), then atomically
  (one `storage.local.set`) seed `aleph_remote_usage` from the union, reset the
  local `usage_*` docs to `{}`, and set `aleph_sync_adopted`. Displayed totals
  are unchanged (`own(0) + cache(union)`); rollups start clean from that
  moment. Runs serialized behind the usage-update queue (`enqueueUsageWork`)
  so a tracker message can never interleave. If the seal fails (offline), no
  flag is set and the next boot retries; rollup pushes stay blocked until
  adopted.
- **Cloud is empty** → *adopt-fresh*: local history is provably this device's
  own; keep it and push it all as rollups at the sign-in full sync.

Still-deployed v1 clients keep max-merging into the legacy docs during the
auto-update window (the rules still allow it); their activity reaches v2
devices through the legacy part of the cache. They do not see v2 rollups —
self-resolves when they update.

## Reliability

- **Dirty-key set** (`aleph_sync_dirty`): keys only, never values — a flush
  reads the *current* local state, so a stale replay can never regress a
  rollup. Marked before the 60s leading+trailing throttle fires; cleared after
  a successful push. Flushed at worker boot, on the 20-minute alarm, and via
  the sign-in full sync (MV3 workers die ~30s idle, losing trailing timers).
- **Readiness gate**: pushes await auth restore + migration; rollup pushes
  additionally require the adopted flag (pre-seal union data is never
  uploaded).
- **Auth**: the chrome.identity token is stored at sign-in/restore so sign-out
  can revoke it. `restoreAuth` is single-flight; on failure it clears the
  cached token and retries once, and only an explicit `auth/*` rejection signs
  the user out (transient/offline failures keep the stored state).
- **Settings echo guard** (`aleph_sync_echo`, persisted): values applied from
  the cloud are recorded before `chrome.storage.sync.set`; the resulting
  `onChanged` echo is consumed one-shot instead of being re-stamped/re-pushed.
- **Batches**: all multi-doc writes/deletes go through `chunkOps` (450/commit).

## Retention

Cloud docs (legacy + rollups) older than **400 days** are deleted client-side
during a full sync. No Firestore TTL policy is used (TTL is not testable in
the emulator). The local remote-cache mirrors the local 90-day retention.

## storage.local keys owned by sync

| Key | Contents |
|---|---|
| `aleph_sync_auth` | `{ signedIn, uid, email, lastSyncAt, token }` |
| `aleph_device_id` | `dev-<uuid>`, minted once |
| `aleph_remote_usage` | `Record<date, UsageDay>` — other devices + legacy baseline |
| `aleph_sync_dirty` | `string[]` of pending push keys |
| `aleph_settings_meta` | `Record<settingKey, epochMs>` local stamps (kept while signed out) |
| `aleph_sync_echo` | pending remote-applied settings values |
| `aleph_sync_schema` / `aleph_sync_adopted` | migration flags (survive sign-out) |

`aleph_sync_queue` (the pre-v2 value-carrying retry queue) is removed at boot.

## Rules: tests and deployment

`firestore.rules` is versioned here and enforces: owner-only access, the
collection/doc allowlist above, date-format doc IDs, and rollup ID ↔
`deviceId`/`date` field consistency. Per-field settings validation is
deliberately client-side (`filterToDefaults`) — v1 clients still write flat
docs during the update window.

- `npm run test:rules` — runs `tests/rules/` against the Firestore emulator
  (needs Java 11+; CI runs this in the `rules-test` job with a cached
  emulator).
- `npm run deploy:rules` — re-runs the emulator gate, then deploys to
  production. First time: `npx firebase login`.

**Deploy order is load-bearing**: deploy rules *before* shipping a client that
writes `usageRollups`/`meta/settings2` — the production rules predating this
file are unknown console state and may deny the new paths.

## Analyzing usage across users

Signed-in users' data is queryable by the project owner (Admin SDK, Firebase
console, or a BigQuery export — all bypass security rules; no client change
needed). Peak-hour analysis: per user/device/day, `platforms.<p>.hours` maps
local hour → active seconds and `platforms.<p>.sends.byHour` maps local hour →
message sends; normalize with `tzOffsetMinutes`. Client queries are
collection-scoped (auto-indexed); a `collectionGroup('usageRollups')` query
from an admin script needs a one-time collection-group index enabled in the
console (not part of this repo, and not needed for the BigQuery route).
Only signed-in users sync — signed-out users' data never leaves their device.
