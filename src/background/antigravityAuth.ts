// Antigravity / Cloud Code OAuth token manager.
//
// The internal cloudcode-pa API only accepts tokens minted by Antigravity's own
// FIRST-PARTY OAuth client — a token from the extension's own client is rejected.
// This borrows the Antigravity CLI's installed-app client (the same one the `agy`
// CLI uses). Its client secret is NOT shipped in the bundle: it is fetched at
// runtime from a public Firestore config doc and cached locally (a user-pasted
// Settings override wins when present), so the feature works out of the box while
// the credential stays out of the published Web Store ZIP and the public repo —
// the two surfaces that auto-flag/revoke it. See remoteConfig.ts + docs/ANTIGRAVITY.md.
// It also needs the `cclog`/`experimentsandconfigs` scopes, the Cloud
// project from loadCodeAssist in the fetchAvailableModels body, AND an
// `antigravity/cli/...` User-Agent on the API call (set via declarativeNetRequest
// — see rules/antigravity-ua.json), since browser fetch can't set User-Agent. The
// flow is auth-code + PKCE with the CLI's loopback redirect; the background reads
// the code from the failed-to-load localhost callback tab URL (see router.ts) — no
// chrome.identity (hardwired to the extension's own client), no native helper, no
// manual paste of the code.
//
// Everything here is opt-in: nothing mints a token until the user clicks Connect
// and completes the Google OAuth consent. The cached secret and the refresh token
// live under insights_ local keys, which are sync-inert by construction (writeLocal
// only pushes usage_*/insights_subscriptions), so they never leave the device.

import { readLocal, writeLocal } from "./usage";
import { getAntigravityClientSecret } from "./remoteConfig";
import type { AntigravityStatusResponse } from "../shared/messages";

// Token-endpoint / id_token JSON is a raw provider boundary.
type RawRecord = Record<string, any>;

const CLIENT_ID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
// The CLI's loopback redirect. The page never loads (nothing listens on 51121);
// the background reads the auth code straight from the failed-load tab URL.
export const ANTIGRAVITY_REDIRECT_URI = "http://localhost:51121/oauth-callback";
const REDIRECT_URI = ANTIGRAVITY_REDIRECT_URI;
const SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
].join(" ");
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export const ANTIGRAVITY_AUTH_KEY = "insights_antigravity_auth";
export const ANTIGRAVITY_PKCE_KEY = "insights_antigravity_pkce";
// The borrowed-client secret. Precedence: a user-pasted override in this key
// (Settings, local-only) wins; otherwise it is fetched from Firestore and cached
// in ANTIGRAVITY_SECRET_CACHE_KEY, so the feature works out of the box without a
// paste and without shipping the secret in the bundle. See remoteConfig.ts.
export const ANTIGRAVITY_SECRET_KEY = "insights_antigravity_secret";
export const ANTIGRAVITY_SECRET_CACHE_KEY = "insights_antigravity_secret_cache";
// Refetch the cached Firestore secret weekly so a rotation is picked up even
// without an invalid_client error to force it.
const SECRET_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Refresh the access token this long before its stated expiry, so a token never
// goes stale mid-request.
const ACCESS_TOKEN_SKEW_MS = 30_000;

export interface AntigravityAuth {
  refreshToken: string;
  accessToken: string | null;
  expiresAt: number | null;
  email: string | null;
  connectedAt: number;
}

// The status the background returns over the wire — single source in messages.ts
// (AntigravityStatusResponse) so the shape can't drift from what popup/settings consume.
export type AntigravityAuthStatus = AntigravityStatusResponse;

// Carries the OAuth `error` code (e.g. "invalid_grant") so the refresh path can
// distinguish a revoked grant (clear + reconnect) from a transient failure.
class TokenError extends Error {
  code: string;
  constructor(code: string, description?: string) {
    super(description || code);
    this.code = code;
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generatePkceVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export async function pkceChallengeS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

export async function buildConsentUrl(verifier: string): Promise<string> {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge: await pkceChallengeS256(verifier),
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
  });
  return AUTH_ENDPOINT + "?" + params.toString();
}

function decodeIdTokenEmail(idToken: unknown): string | null {
  if (typeof idToken !== "string" || !idToken.includes(".")) return null;
  try {
    const part = idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = part + "=".repeat((4 - (part.length % 4)) % 4);
    const json = JSON.parse(atob(padded)) as RawRecord;
    return typeof json?.email === "string" ? json.email : null;
  } catch (e) {
    return null;
  }
}

async function postToken(body: Record<string, string>): Promise<RawRecord> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    credentials: "omit",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const data = (await response.json().catch(() => null)) as RawRecord | null;
  if (!response.ok || !data || data.error) {
    throw new TokenError(String(data?.error || response.status), data?.error_description);
  }
  return data;
}

// In-memory access-token cache — saves a refresh on the hot path within a worker
// lifetime. Storage (accessToken+expiresAt) is the source of truth across worker
// deaths, so this is purely an optimization.
let _cachedAccess: { token: string; expiresAt: number } | null = null;

interface CachedSecret { secret: string; fetchedAt: number }

// Single-flight guard so concurrent callers (boot, refresh, connect) trigger at
// most one Firestore fetch.
let _secretFetch: Promise<string> | null = null;

async function fetchAndCacheSecret(): Promise<string> {
  const remote = await getAntigravityClientSecret();
  if (!remote) return "";
  await writeLocal(ANTIGRAVITY_SECRET_CACHE_KEY, { secret: remote, fetchedAt: Date.now() } as CachedSecret);
  return remote;
}

function ensureSecretFetch(): Promise<string> {
  if (!_secretFetch) {
    // Capture the promise so a stale `.finally` can't clear a newer in-flight fetch.
    const p: Promise<string> = fetchAndCacheSecret().finally(() => { if (_secretFetch === p) _secretFetch = null; });
    _secretFetch = p;
  }
  return _secretFetch;
}

// Populate the secret cache from Firestore once (unless an override or cache is
// already present) so the Connect CTA can appear out of the box. Called fire-and-
// forget at background boot — NOT on the status/meter path, so a non-opted-in user
// issues at most this one public-config read.
export async function ensureAntigravitySecretCached(): Promise<void> {
  if (await readAvailableSecret()) return;
  await ensureSecretFetch();
}

// The user-pasted override (Settings, local-only); empty when unset.
async function readUserOverride(): Promise<string> {
  return (await readLocal<string>(ANTIGRAVITY_SECRET_KEY, "")).trim();
}

// The two local secret sources, read once (the cache is skipped when an override
// wins). Shared by readAvailableSecret (status) and readClientSecret (mint).
async function readSecretSources(): Promise<{ override: string; cache: CachedSecret | null }> {
  const override = await readUserOverride();
  const cache = override ? null : await readLocal<CachedSecret | null>(ANTIGRAVITY_SECRET_CACHE_KEY, null);
  return { override, cache };
}

// Is a secret available WITHOUT a network fetch — an override, or any cached
// Firestore secret (fresh or not)? Drives status/`configured`, so the Connect CTA
// only shows when a secret really exists and status never blocks on Firestore.
async function readAvailableSecret(): Promise<string> {
  const { override, cache } = await readSecretSources();
  return override || (cache?.secret || "").trim();
}

// Resolve the client secret for a mint path: override → fresh cache → fetch (then
// cache), falling back to a stale cache if the fetch fails. Only called in opted-in
// contexts (an explicit Connect, or a connected account's token refresh).
async function readClientSecret(): Promise<string> {
  const { override, cache } = await readSecretSources();
  if (override) return override;
  if (cache?.secret && cache.fetchedAt && Date.now() - cache.fetchedAt < SECRET_CACHE_TTL_MS) {
    return cache.secret.trim();
  }
  const fetched = await ensureSecretFetch();
  return (fetched || cache?.secret || "").trim();
}

// On invalid_client (the borrowed secret was rotated or revoked) force a fresh
// fetch and REPLACE the cache atomically: overwrite with a new secret if the doc
// serves one, else clear the cache so status reports not-connected and stale meters
// clear. No empty window that could flip a connected user mid-refresh. Returns the
// refreshed secret ("" if the doc is gone/unreadable).
async function refreshCachedSecret(): Promise<string> {
  _secretFetch = null;
  const remote = await getAntigravityClientSecret();
  if (remote) {
    await writeLocal(ANTIGRAVITY_SECRET_CACHE_KEY, { secret: remote, fetchedAt: Date.now() } as CachedSecret);
    return remote;
  }
  await chrome.storage.local.remove(ANTIGRAVITY_SECRET_CACHE_KEY);
  return "";
}

// Save (or, when blank, clear) the user-entered client secret. A change drops the
// in-memory access-token cache so the next mint uses the new secret.
export async function setAntigravitySecret(secret: string): Promise<void> {
  _cachedAccess = null;
  const trimmed = secret.trim();
  if (!trimmed) {
    await chrome.storage.local.remove(ANTIGRAVITY_SECRET_KEY);
    return;
  }
  await writeLocal(ANTIGRAVITY_SECRET_KEY, trimmed);
}

// Make + stash a PKCE verifier and return the consent URL. The verifier is
// stored (not just held in memory) so the code exchange survives a worker death
// between opening the consent tab and the redirect landing.
export async function startAntigravityConnect(): Promise<{ url: string }> {
  if (!(await readClientSecret())) throw new Error("Couldn't reach the Antigravity service — check your connection and try again.");
  const verifier = generatePkceVerifier();
  await writeLocal(ANTIGRAVITY_PKCE_KEY, verifier);
  return { url: await buildConsentUrl(verifier) };
}

export async function captureAntigravityCode(code: string): Promise<{ success: boolean; email?: string; error?: string }> {
  const secret = await readClientSecret();
  if (!secret) return { success: false, error: "Couldn't reach the Antigravity service — check your connection and try again." };
  const verifier = await readLocal<string | null>(ANTIGRAVITY_PKCE_KEY, null);
  if (!verifier) return { success: false, error: "Connection expired — click Connect again." };
  try {
    const data = await postToken({
      client_id: CLIENT_ID,
      client_secret: secret,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI,
    });
    if (!data.refresh_token) {
      return { success: false, error: "No refresh token returned — revoke prior access at myaccount.google.com and retry." };
    }
    const email = decodeIdTokenEmail(data.id_token);
    const auth: AntigravityAuth = {
      refreshToken: data.refresh_token,
      accessToken: data.access_token || null,
      expiresAt: data.expires_in ? Date.now() + Number(data.expires_in) * 1000 : null,
      email,
      connectedAt: Date.now(),
    };
    _cachedAccess = auth.accessToken && auth.expiresAt ? { token: auth.accessToken, expiresAt: auth.expiresAt } : null;
    await writeLocal(ANTIGRAVITY_AUTH_KEY, auth);
    await chrome.storage.local.remove(ANTIGRAVITY_PKCE_KEY);
    return { success: true, email: email || undefined };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function getAntigravityAccessToken(): Promise<string | null> {
  const now = Date.now();
  if (_cachedAccess && _cachedAccess.expiresAt - ACCESS_TOKEN_SKEW_MS > now) return _cachedAccess.token;

  // Only a connected account (a stored refresh token) needs the client secret —
  // check that BEFORE reading/fetching the secret, so a user who never connected
  // never triggers a Firestore read on the meter-refresh hot path.
  const auth = await readLocal<AntigravityAuth | null>(ANTIGRAVITY_AUTH_KEY, null);
  if (!auth?.refreshToken) return null;

  if (auth.accessToken && auth.expiresAt && auth.expiresAt - ACCESS_TOKEN_SKEW_MS > now) {
    _cachedAccess = { token: auth.accessToken, expiresAt: auth.expiresAt };
    return auth.accessToken;
  }

  // The stored token is stale — only now do we need the secret (fetched just for
  // this connected account).
  let secret = await readClientSecret();
  if (!secret) return null;

  // Attempt the refresh; on invalid_client (the borrowed secret was rotated or
  // revoked) drop the cached Firestore secret, refetch, and retry once.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const data = await postToken({
        client_id: CLIENT_ID,
        client_secret: secret,
        grant_type: "refresh_token",
        refresh_token: auth.refreshToken,
      });
      const accessToken = (data.access_token as string) || null;
      const expiresAt = data.expires_in ? now + Number(data.expires_in) * 1000 : null;
      _cachedAccess = accessToken && expiresAt ? { token: accessToken, expiresAt } : null;
      await writeLocal(ANTIGRAVITY_AUTH_KEY, { ...auth, accessToken, expiresAt });
      return accessToken;
    } catch (e) {
      // A revoked/expired refresh token can't recover without re-consent — clear
      // it so the UI prompts a reconnect. Transient errors keep the stored auth.
      if (e instanceof TokenError && e.code === "invalid_grant") {
        _cachedAccess = null;
        await chrome.storage.local.remove(ANTIGRAVITY_AUTH_KEY);
        return null;
      }
      if (e instanceof TokenError && e.code === "invalid_client" && attempt === 0) {
        const refreshed = await refreshCachedSecret();
        if (refreshed && refreshed !== secret) { secret = refreshed; continue; }
      }
      return null;
    }
  }
  return null;
}

export async function getAntigravityAuthStatus(): Promise<AntigravityAuthStatus> {
  // "configured" = a secret is available without a network fetch (an override, or a
  // cached Firestore secret) → the Connect CTA can actually succeed. The cache is
  // primed once at boot (ensureAntigravitySecretCached), and the popup/settings
  // re-render on the cache key, so the CTA appears once the fetch lands. This
  // function itself never fetches — providerUsage calls it on the meter path.
  const configured = Boolean(await readAvailableSecret());
  const auth = await readLocal<AntigravityAuth | null>(ANTIGRAVITY_AUTH_KEY, null);
  // Connected only while a secret is available to mint with: if it's revoked/gone,
  // report not-connected so the UI hides the ⚡ indicator and stale meters clear.
  if (!configured || !auth?.refreshToken) return { connected: false, configured };
  return { connected: true, configured, email: auth.email ?? null, connectedAt: auth.connectedAt ?? null };
}

export async function disconnectAntigravity(): Promise<void> {
  _cachedAccess = null;
  await chrome.storage.local.remove([ANTIGRAVITY_AUTH_KEY, ANTIGRAVITY_PKCE_KEY]);
}

export function _resetAntigravityAuthForTests() {
  _cachedAccess = null;
  _secretFetch = null;
}
