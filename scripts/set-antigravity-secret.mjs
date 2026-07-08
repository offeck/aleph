// Writes the borrowed Antigravity OAuth client secret to Firestore
// `config/antigravity`, where the extension reads it at runtime (see
// docs/ANTIGRAVITY.md). Maintainer-only and dependency-free: it uses the Firestore
// REST API with an access token you provide, so nothing new is added to the
// bundle or to npm deps. The literal secret is read from the gitignored
// `.antigravity-secret` file in the repo root and never enters the repo.
//
// Deploy the rules FIRST (`npm run deploy:rules`) so the `config` read path exists.
//
// Usage (token from gcloud, project-editor account):
//   FIRESTORE_ACCESS_TOKEN="$(gcloud auth print-access-token)" \
//     node scripts/set-antigravity-secret.mjs [version]
// `version` is optional metadata (defaults to a timestamp); bump it when rotating.
// If you have no CLI token, set the doc by hand in the Firebase Console instead
// (Firestore -> config -> antigravity -> fields: secret [string], version [number]).
import { readFileSync } from "node:fs";

const PROJECT = "aleph-ai-chat-styler";
const DOC_PATH = "config/antigravity";

const token = process.env.FIRESTORE_ACCESS_TOKEN;
if (!token) {
  console.error("Set FIRESTORE_ACCESS_TOKEN, e.g. FIRESTORE_ACCESS_TOKEN=\"$(gcloud auth print-access-token)\".");
  process.exit(1);
}

let secret;
try {
  secret = readFileSync(new URL("../.antigravity-secret", import.meta.url), "utf8").trim();
} catch {
  console.error("Missing .antigravity-secret (gitignored) in the repo root — put the borrowed client secret there.");
  process.exit(1);
}
if (!secret) {
  console.error(".antigravity-secret is empty.");
  process.exit(1);
}

const versionArg = process.argv[2];
let version;
if (versionArg === undefined) {
  version = Date.now();
} else if (Number.isSafeInteger(Number(versionArg))) {
  version = Number(versionArg); // Firestore integerValue: must be a whole, in-range number
} else {
  console.error(`version must be a whole number (got "${versionArg}").`);
  process.exit(1);
}
const url =
  `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${DOC_PATH}` +
  `?updateMask.fieldPaths=secret&updateMask.fieldPaths=version&updateMask.fieldPaths=updatedAt`;
const body = {
  fields: {
    secret: { stringValue: secret },
    version: { integerValue: String(version) },
    updatedAt: { timestampValue: new Date().toISOString() },
  },
};

const res = await fetch(url, {
  method: "PATCH",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
if (!res.ok) {
  console.error(`Firestore write failed (${res.status}):`, await res.text());
  process.exit(1);
}
console.log(`Wrote ${DOC_PATH} (version ${version}, ${secret.length} secret chars) to ${PROJECT}.`);
