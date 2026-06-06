import { alephSync } from "./sync";
import { registerBackgroundListeners } from "./router";

declare function importScripts(...urls: string[]): void;
declare const firebase: any;
declare const ALEPH_FIREBASE_CONFIG: { apiKey: string; [key: string]: unknown };

// The bundled service worker lives in dist/, so vendor paths must be
// root-absolute (relative paths would resolve against dist/).
// Bundled imports above are hoisted ahead of this call by esbuild — every
// background submodule is define-only at import time, so nothing touches
// firebase before these scripts load.
importScripts(
  "/vendor/firebase/firebase-app-compat.js",
  "/vendor/firebase/firebase-auth-compat.js",
  "/vendor/firebase/firebase-firestore-compat.js",
  "/vendor/firebase/firebase-config.js"
);

if (ALEPH_FIREBASE_CONFIG.apiKey !== "PLACEHOLDER") {
  firebase.initializeApp(ALEPH_FIREBASE_CONFIG);
  alephSync.init(firebase);
  alephSync.restoreAuth();
}

// MV3: all chrome.* listeners must be registered in the worker's first
// synchronous turn.
registerBackgroundListeners();
