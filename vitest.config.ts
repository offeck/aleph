import { defineConfig } from "vitest/config";

export default defineConfig({
  // Build-time-injected in real builds (see build.mjs); a deterministic stand-in
  // here keeps the antigravityAuth token-exchange tests on the configured path.
  define: {
    __ANTIGRAVITY_CLIENT_SECRET__: JSON.stringify("test-antigravity-secret"),
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.spec.ts"],
    globals: false,
  },
});
