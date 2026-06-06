import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

// Syntactic lint only — tsc strict (zero errors, see tsconfig.json) is the
// type gate. Type-aware configs are deferred deliberately: their no-unsafe-*
// rules conflict with the documented boundary-`any` policy, and
// no-floating-promises conflicts with the extension's fire-and-forget style.
export default tseslint.config(
  {
    ignores: ["dist/", "vendor/", "node_modules/"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // `catch (e) {}` is the established no-fail pattern around chrome.* calls.
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Plan-detection regexes intentionally match NBSP in live page text.
      "no-irregular-whitespace": ["error", { skipRegExps: true }],
      // `cond ? activate() : deactivate();` statements are established style.
      "@typescript-eslint/no-unused-expressions": ["error", { allowTernary: true }],
      // Match tsc noUnusedLocals/noUnusedParameters semantics: catch vars are
      // exempt and `_`-prefixed params are intentional.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
      // Boundary `any` (raw provider/storage JSON, firebase compat) is governed
      // by comments + review, not lint.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // Node build/tooling scripts (plain ESM, not in the tsconfig program).
    files: ["build.mjs", "scripts/**/*.mjs", "eslint.config.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        fetch: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
  },
);
