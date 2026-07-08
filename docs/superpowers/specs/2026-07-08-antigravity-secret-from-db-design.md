# Antigravity client secret from Firestore — design

Date: 2026-07-08
Status: approved design, pending implementation

## Problem

The Antigravity (Cloud Code) quota feature needs Antigravity CLI's **first-party**
OAuth client secret to mint tokens — the internal `cloudcode-pa` API rejects any
third-party client (`403 SERVICE_DISABLED`). Today the user must paste that secret
into Settings. It is deliberately kept out of the published CWS ZIP **and** the
public repo, because a Google first-party OAuth secret in either surface gets
auto-flagged (CWS review) or auto-revoked (GitHub secret-scanning reports to
Google). The manual paste is the friction we want to remove.

## Goal

Make Antigravity work out of the box — no manual paste — **without** shipping the
secret in the build.

## Approach (approved)

Store the secret in a world-readable Firestore doc `config/antigravity`, fetched at
runtime by the background worker and cached in `chrome.storage.local`.

Why this is sound:
- Keeps the secret out of the **two auto-scanned surfaces** (the CWS ZIP and the
  public repo) — the only places that trigger automated flag/revoke.
- **Remotely rotatable**: if Google revokes the borrowed secret, update one doc and
  every client recovers — no new extension release.
- No user paste → out of the box.

Security reality (explicitly accepted): the secret becomes readable by anyone who
installs the extension (the Firebase web config is already in the bundle, and the
secret is already extractable from `agy.exe`). The win is avoiding the automated
scanners + rotation, not true secrecy. Nothing auto-connects — the OAuth consent
the user performs remains the real opt-in; we only remove the paste step.

## Components

### 1. `src/background/remoteConfig.ts` (new)
- `getAntigravityClientSecret(): Promise<{ secret: string; version: number } | null>`
- Reads `config/antigravity` through the `firebase` global (already initialized at
  boot in `index.ts`). Guarded on `firebase?.apps?.length` — returns `null` when
  Firebase is uninitialized (dev / `PLACEHOLDER` config) or the doc is missing /
  unreadable, so the feature degrades gracefully to the paste field.
- No auth needed (public read). Single-purpose, unit-testable (firestore handle
  injectable for tests).

### 2. `src/background/antigravityAuth.ts` (modified)
- Keep `ANTIGRAVITY_SECRET_KEY` (user paste — now an optional override).
- Add `ANTIGRAVITY_SECRET_CACHE_KEY = "insights_antigravity_secret_cache"` holding
  `{ secret, version, fetchedAt }` (local, sync-inert like the other `insights_` keys).
- `readClientSecret()` precedence (async, single-flight):
  1. user-pasted secret, if set → use it (maintainer / power-user override);
  2. cached DB secret, if present and within TTL → use it;
  3. otherwise fetch via `remoteConfig`, cache it, use it; return `""` on failure.
- **Single-flight**: one in-flight fetch promise shared across concurrent callers
  (`getAntigravityAccessToken`, `getAntigravityAuthStatus`, connect paths).
- `getAntigravityAuthStatus().configured` = true when a secret is resolvable
  (user or cache). Status stays fast: it reads user/cache only and kicks off a
  background fetch when neither is present, so the Connect CTA appears on the next
  popup open rather than blocking the first.
- **Rotation**: on an `invalid_client` error while minting (`postToken`), drop the
  cached DB secret and refetch once, then retry the mint. A TTL (7 days) also
  triggers a proactive refetch.

### 3. `firestore.rules` (modified)
Add, alongside the existing deny-by-default `/users/{uid}` tree:
```
match /config/{doc} {
  allow read: if true;      // public app config (the borrowed OAuth secret)
  allow write: if false;    // writes only via the admin SDK (bypasses rules)
}
```
Deny-by-default everywhere else is unchanged; no user data lives under `/config`.

### 4. Settings UI (`src/settings/antigravityUi.ts`)
Copy tweak only: the client-secret paste field becomes an optional **advanced
override** ("Antigravity works automatically; paste your own client secret only to
override"). No behavioural change beyond wording.

### 5. Admin tooling (`scripts/set-antigravity-secret.mjs`, new, gitignored value)
Node + `firebase-admin`: reads the secret from the gitignored `.antigravity-secret`
file and writes `config/antigravity = { secret, version, updatedAt }`. Requires
maintainer Firebase credentials (`firebase login` / `GOOGLE_APPLICATION_CREDENTIALS`).
The literal secret never enters the repo. Documented in `docs/ANTIGRAVITY.md`.

## Data flow

1. Popup opens → status check → `readClientSecret()` (user? cache?). If neither, a
   background fetch populates the cache; the Connect CTA shows on next open.
2. User clicks Connect → existing OAuth code+PKCE flow → mint with the resolved secret.
3. Rotation: maintainer reruns the admin script with a new `version`; clients
   refetch on the next `invalid_client` mint error or when the TTL lapses.

## Deploy order (per repo convention — rules before the reading client)

1. `npm run deploy:rules` (adds the public `config` read) — MUST land first.
2. Run `scripts/set-antigravity-secret.mjs` to write the doc.
3. Ship the client build that reads it.

## Tests

- `tests/unit/antigravity-auth.spec.ts` (extend): precedence (user > cache > fetch),
  cache reuse (no refetch within TTL), `invalid_client` invalidation + refetch,
  graceful `null`/`""` when Firebase is absent. Fakes for `remoteConfig` + storage.
- `tests/unit/remote-config.spec.ts` (new): parses the doc shape; returns `null` on
  missing doc / uninitialized Firebase.
- `tests/rules/`: `config/antigravity` readable while unauthenticated; client writes
  denied; existing `/users/{uid}` ownership rules still hold.

## Out of scope / future

- App Check attestation to restrict reads to genuine app instances (extra infra;
  the exposure is accepted for now).
- Re-capturing the popup screenshot store asset (cosmetic).
