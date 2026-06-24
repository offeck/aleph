// Antigravity / Cloud Code OAuth token manager.
//
// The internal cloudcode-pa API only accepts tokens minted by Antigravity's own
// FIRST-PARTY OAuth client — a token from the extension's own client is rejected.
// This borrows the Antigravity CLI's installed-app client (the same one the `agy`
// CLI uses). Its client secret is NOT shipped in the bundle: the user pastes it
// into Settings (stored under an insights_ local key) and the feature stays inert
// until they do — connect fails closed and nothing mints a token without it. This
// deliberately keeps a Google first-party credential out of the published Web
// Store ZIP. It also needs the `cclog`/`experimentsandconfigs` scopes, the Cloud
// project from loadCodeAssist in the fetchAvailableModels body, AND an
// `antigravity/cli/...` User-Agent on the API call (set via declarativeNetRequest
// — see rules/antigravity-ua.json), since browser fetch can't set User-Agent. The
// flow is auth-code + PKCE with the CLI's loopback redirect; the background reads
// the code from the failed-to-load localhost callback tab URL (see router.ts) — no
// chrome.identity (hardwired to the extension's own client), no native helper, no
// manual paste of the code.
//
// Everything here is opt-in: nothing mints a token until the user enters the
// secret and clicks Connect. Both the secret and the refresh token live under
// insights_ local keys, which are sync-inert by construction (writeLocal only
// pushes usage_*/insights_subscriptions), so they never leave the device.

import { readLocal, writeLocal } from "./usage";
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
// The borrowed-client secret the user pastes in Settings. Local-only (sync-inert)
// and never shipped in the bundle — the feature is inert until this is set.
export const ANTIGRAVITY_SECRET_KEY = "insights_antigravity_secret";
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

// The client secret is user-supplied (Settings) and lives in local storage, so
// every mint path reads it fresh — there is no build-time constant anymore.
async function readClientSecret(): Promise<string> {
  return (await readLocal<string>(ANTIGRAVITY_SECRET_KEY, "")).trim();
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
  if (!(await readClientSecret())) throw new Error("Add your Antigravity client secret in Settings first.");
  const verifier = generatePkceVerifier();
  await writeLocal(ANTIGRAVITY_PKCE_KEY, verifier);
  return { url: await buildConsentUrl(verifier) };
}

export async function captureAntigravityCode(code: string): Promise<{ success: boolean; email?: string; error?: string }> {
  const secret = await readClientSecret();
  if (!secret) return { success: false, error: "Add your Antigravity client secret in Settings first." };
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

  const secret = await readClientSecret();
  if (!secret) return null;

  const auth = await readLocal<AntigravityAuth | null>(ANTIGRAVITY_AUTH_KEY, null);
  if (!auth?.refreshToken) return null;

  if (auth.accessToken && auth.expiresAt && auth.expiresAt - ACCESS_TOKEN_SKEW_MS > now) {
    _cachedAccess = { token: auth.accessToken, expiresAt: auth.expiresAt };
    return auth.accessToken;
  }

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
    }
    return null;
  }
}

export async function getAntigravityAuthStatus(): Promise<AntigravityAuthStatus> {
  const configured = Boolean(await readClientSecret());
  const auth = await readLocal<AntigravityAuth | null>(ANTIGRAVITY_AUTH_KEY, null);
  // A stored token is only usable while a client secret is saved (the mint path
  // needs it). With the secret cleared we report not-connected even with a
  // leftover token — so the UI hides the ⚡ indicator and stale meters get cleared
  // rather than freezing.
  if (!configured || !auth?.refreshToken) return { connected: false, configured };
  return { connected: true, configured, email: auth.email ?? null, connectedAt: auth.connectedAt ?? null };
}

export async function disconnectAntigravity(): Promise<void> {
  _cachedAccess = null;
  await chrome.storage.local.remove([ANTIGRAVITY_AUTH_KEY, ANTIGRAVITY_PKCE_KEY]);
}

export function _resetAntigravityAuthForTests() {
  _cachedAccess = null;
}
