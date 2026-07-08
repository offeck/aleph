// Public app config read from Firestore (the `config/*` collection).
//
// Used to serve the borrowed Antigravity OAuth client secret to the extension at
// runtime instead of shipping it in the CWS ZIP or committing it to the public
// repo — the two surfaces that get a Google first-party secret auto-flagged or
// auto-revoked. The doc is world-readable (firestore.rules: `config/{doc}` allow
// read: if true), so no signed-in user is required; it stays out of static
// artifacts and becomes remotely rotatable. See docs/ANTIGRAVITY.md.
//
// The firebase compat SDK is loaded via importScripts in index.ts, exposing the
// `firebase` global (boundary `any`). This module is inert until that global is
// initialized: in dev / PLACEHOLDER-config builds it returns null, so callers
// degrade to the user-entered secret.
declare const firebase: any;

// Firestore document JSON is a raw provider boundary.
type RawRecord = Record<string, any>;

const ANTIGRAVITY_CONFIG_PATH = "config/antigravity";

// Reads the borrowed client secret from config/antigravity. Public read — no auth.
// Returns the trimmed secret, or null when firebase is uninitialized (dev /
// PLACEHOLDER), the doc is missing/empty, or on any read error — so the feature
// never hard-fails on a config-fetch problem. (The doc may also carry a `version`
// field as maintainer metadata; the client doesn't need it.)
export async function getAntigravityClientSecret(): Promise<string | null> {
  try {
    // typeof guard first: `firebase` is undefined in unit tests / non-worker
    // contexts and referencing it directly would throw.
    if (typeof firebase === "undefined" || !firebase?.apps?.length) return null;
    const snap = await firebase.firestore().doc(ANTIGRAVITY_CONFIG_PATH).get();
    if (!snap?.exists) return null;
    const data = (snap.data() || {}) as RawRecord;
    const secret = typeof data.secret === "string" ? data.secret.trim() : "";
    return secret || null;
  } catch (e) {
    return null;
  }
}
