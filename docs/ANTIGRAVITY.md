# Antigravity (Cloud Code) usage — dev notes

Experimental, opt-in feature: surface Google Antigravity (Cloud Code) per-model
quota in the popup's usage meters. It reads the cloud quota the `agy` CLI 2.0 reads
in its `/usage`, using Antigravity's **first-party** OAuth client.

## The secret is user-entered, never shipped

The internal `cloudcode-pa` API only accepts tokens minted by Antigravity's own
first-party OAuth client — a token from the extension's own client is rejected
(`403 SERVICE_DISABLED`). So the feature borrows the Antigravity CLI's installed-app
client. Its client secret is **not** a build input and is **never** placed in the
shipped bundle: embedding a Google first-party credential in the Web Store ZIP is a
review/policy risk (it could get the extension flagged or banned).

Instead the user pastes the secret into **Settings → Antigravity**. It is stored in
`chrome.storage.local` under `insights_antigravity_secret` (sync-inert — it never
leaves the device), and the whole feature stays inert until a secret is saved:
`getAntigravityAuthStatus().configured` is `false`, the popup hides the Connect CTA,
and nothing mints a token. See `src/background/antigravityAuth.ts`.

The build no longer reads a `.antigravity-secret` file or an
`ANTIGRAVITY_CLIENT_SECRET` env var — both were removed, so the build never sees
the secret. (A gitignored `.antigravity-secret` file may still exist locally as a
handy place to stash the value for copy-paste; the build ignores it.)

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
