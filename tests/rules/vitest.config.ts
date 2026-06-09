import { defineConfig } from "vitest/config";

// Separate config: these specs need the Firestore emulator (Java), so they
// run via `npm run test:rules` (firebase emulators:exec) — never under the
// default `npm test` include.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/rules/**/*.spec.ts"],
    globals: false,
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});
