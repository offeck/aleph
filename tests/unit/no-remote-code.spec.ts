import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Chrome Web Store MV3 policy forbids remotely-hosted code. Firebase's auth SDK
// ships a browser-default config that injects these scripts at runtime via a
// document.createElement("script") loader (signInWithPopup/redirect, phone auth,
// reCAPTCHA). Aleph signs in only through chrome.identity + signInWithCredential
// and stores data in Firestore — those loader paths are never reached. An upload
// was rejected ("Blue Argon", violation ref) because these URL literals were
// present in the shipped bundle. Guard against them reappearing if the vendored
// SDK is ever refreshed.
const FORBIDDEN_REMOTE_SCRIPTS = [
  "https://apis.google.com/js/api.js",
  "https://www.google.com/recaptcha/api.js",
  "https://www.google.com/recaptcha/enterprise.js",
];

describe("no remotely-hosted code in vendored bundles", () => {
  const dir = "vendor/firebase";
  const jsFiles = readdirSync(dir).filter((f) => f.endsWith(".js"));

  it("finds the vendored firebase bundles to scan", () => {
    expect(jsFiles.length).toBeGreaterThan(0);
  });

  for (const file of jsFiles) {
    it(`${file} contains no remote-script loader URLs`, () => {
      const text = readFileSync(`${dir}/${file}`, "utf8");
      for (const url of FORBIDDEN_REMOTE_SCRIPTS) {
        expect(text).not.toContain(url);
      }
    });
  }
});
