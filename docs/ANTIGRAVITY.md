# Antigravity (Cloud Code) usage — dev notes

Experimental, opt-in feature: surface Google Antigravity (Cloud Code) per-model
quota in the popup's usage meters. It reads the cloud quota the `agy` CLI 2.0 reads
in its `/usage`, using Antigravity's **first-party** OAuth client.

## The secret is served from Firestore, never shipped

The internal `cloudcode-pa` API only accepts tokens minted by Antigravity's own
first-party OAuth client — a token from the extension's own client is rejected
(`403 SERVICE_DISABLED`). So the feature borrows the Antigravity CLI's installed-app
client. Its client secret is **never** placed in the shipped bundle or committed to
this (public) repo: a Google first-party credential in the CWS ZIP is a review/policy
risk, and in the repo it trips GitHub secret-scanning (which reports to Google, which
can auto-revoke).

Instead the extension **fetches it at runtime** from a world-readable Firestore doc,
`config/antigravity` (`{ secret, version }`), and caches it in `chrome.storage.local`
under `insights_antigravity_secret_cache`. So Antigravity works out of the box — no
paste — while the credential stays out of both auto-scanned surfaces and is remotely
rotatable. The read needs no sign-in (`firestore.rules`: `config/{doc}` allow read).
See `src/background/remoteConfig.ts`.

Precedence (in `readClientSecret`, `src/background/antigravityAuth.ts`): a user-pasted
override in **Settings → Antigravity** (`insights_antigravity_secret`, local-only)
wins; otherwise the fresh cached Firestore secret; otherwise a fresh fetch. The secret
is fetched in exactly three places: once at background boot (`ensureAntigravitySecretCached`
— a single public-config read that primes the cache so the Connect CTA can appear out of
the box; a no-op once cached/overridden), an explicit Connect, and a connected account's
token refresh. It is **never** fetched on the status/meter path — `getAntigravityAuthStatus`
and `getAntigravityAccessToken` short-circuit before any secret read for a user with no
stored grant, so a non-opted-in account issues no per-refresh reads. The Connect CTA shows
when `getAntigravityAuthStatus().configured` is true — a secret is available with no network
fetch (an override, or the cached secret); the popup/settings re-render on the
`insights_antigravity_secret_cache` key so the CTA appears once the boot fetch lands.
Nothing auto-connects: the user still completes the Google OAuth consent to mint a token.
On an `invalid_client` mint error (secret rotated/revoked) the client atomically refetches
and replaces the cache — overwriting with a new secret if the doc serves one, else clearing
it so status reports not-connected and stale meters clear; a 7-day TTL also refetches
proactively on the connected refresh path.

Security reality (accepted): a world-readable doc means the secret is obtainable by
anyone who installs the extension (the Firebase web config is already in the bundle,
and the secret is already extractable from `agy.exe`). The value here is keeping it
out of the CWS ZIP + public repo — the auto-scanned surfaces — and gaining remote
rotation, not true secrecy.

## Writing / rotating the secret (maintainer)

The literal secret lives only in the gitignored `.antigravity-secret` file on the
maintainer's machine (never committed — GitHub push protection). To publish it:

1. **Deploy the rules first** so the read path exists (repo convention — rules before
   the reading client): `npm run deploy:rules`.
2. **Write the doc**, either:
   - `FIRESTORE_ACCESS_TOKEN="$(gcloud auth print-access-token)" node scripts/set-antigravity-secret.mjs [version]`
     — a dependency-free Firestore REST write; the token needs Datastore /
     cloud-platform scope on `aleph-ai-chat-styler`; or
   - by hand in the Firebase Console: Firestore → collection `config` → doc
     `antigravity` → fields `secret` (string), `version` (number).
3. Ship the client build that reads it.

To **rotate**: re-extract the secret into `.antigravity-secret`, rerun step 2 with a
bumped `version`. Clients recover on their next `invalid_client` error or TTL refetch.
The build never reads `.antigravity-secret` or an `ANTIGRAVITY_CLIENT_SECRET` env var
— the secret is not a build input.

## The borrowed-client credential (paste these into Settings to test)

> These are Antigravity CLI's own installed-app credentials (extractable from
> `agy.exe`), not Aleph's. The literal values are deliberately **not** committed
> here: this repo is public, and GitHub secret-scanning reports Google OAuth
> secrets to Google (which can auto-revoke them). The real client secret lives in
> the gitignored `.antigravity-secret` file on the maintainer's machine — copy it
> from there to test, or re-extract it from `agy.exe`.

- **Client ID** (public, not secret): see `CLIENT_ID` in `src/background/antigravityAuth.ts`.
- **Client secret**: paste it in Settings → Antigravity. The value is in the local `.antigravity-secret` file (gitignored), not in this doc.
- **Scopes**: `cloud-platform`, `userinfo.email`, `userinfo.profile`, `cclog`, `experimentsandconfigs`
- **Redirect**: loopback `http://localhost:51121/oauth-callback` (the page never loads; the background reads the auth code from the failed-load tab URL)

A second client in `agy.exe` (a `884354919052-…` id with its own `GOCSPX-…` secret)
is for metrics, not user quota — it also 403s. Don't use it.

## Cloud recipe (the two non-obvious gates)

1. `POST https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist`
   body `{"metadata":{"ideType":"ANTIGRAVITY","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}}`
   → read `cloudaicompanionProject.id` (e.g. `seraphic-shape-c2tjw`). (`tier` shows
   `free-tier` — ignore; the per-model quota is the real data.)
2. `POST .../v1internal:fetchAvailableModels` body `{"project":"<that id>"}`
   → `models` dict keyed by model id, each `{displayName, quotaInfo:{remainingFraction, resetTime}}`.

Both gates are **required** (client/secret/scopes alone all 403):

- The **project id** from step 1 must be in the step-2 body (not `{}`).
- **`User-Agent: antigravity/cli/1.0.7 windows/amd64`** on the API call. Browser
  `fetch()` can't set User-Agent, so it's applied via MV3 `declarativeNetRequest`
  modifyHeaders on requests to `daily-cloudcode-pa.googleapis.com` — see
  `rules/antigravity-ua.json`.

Prompt **credits** (the 50000 number) are not in the cloud `loadCodeAssist`
response — only the local `GetUserStatus` had them. The cloud path yields per-model
quota (the main rows), not the credits number. `normalizeAntigravityUsage` in
`src/tracker/usageAntigravity.ts` already matches the `models`-dict shape.
