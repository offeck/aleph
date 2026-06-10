# Aleph — AI Chat Styler

## Development Guidelines

### 1. Restate Before Acting
- Before implementing, restate the request back to confirm understanding
- If multiple interpretations exist, present them — don't pick silently
- If something is unclear, stop and ask rather than guess
- State your assumptions explicitly so they can be corrected early

### 2. Search Before Building
- Before writing new code, search the codebase for existing utilities, patterns, or similar implementations
- Aleph already has shared patterns (platform detection, selector sets, `applyStyles()`, `patchAll()`) — use them
- Don't reimplement what already exists in a different form
- Check `SELECTORS[platform]` before hardcoding selectors; check `THEMES` before adding color logic

### 3. Generalized Solutions Only
- Every fix must address the root cause, not just the visible symptom
- Never monkey-patch or write a fix that only covers one occurrence of a general problem
- Before implementing, ask: "Will this fix ALL instances of this class of bug, or just the one I'm looking at?"
- If a pattern appears in multiple places, fix the shared function — not each call site individually
- If a selector breaks on one platform, check whether the same class of selector is fragile on other platforms too

### 4. Simplicity First
- Minimum code that solves the problem — nothing speculative
- No features, abstractions, or "flexibility" beyond what was asked
- If 200 lines could be 50, rewrite it
- Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify

### 5. Surgical Changes
- Only modify what the task requires — don't "improve" adjacent code, comments, or formatting
- Match existing code style even if you'd do it differently
- Remove only dead code that YOUR changes created, not pre-existing dead code
- Every changed line should trace directly to the request
- Don't refactor things that aren't broken

### 6. Tests Are Part of the Change
- Every behavioral change must add or update automated coverage that would fail before the change, unless automation is genuinely impractical
- Bug fixes need a failing unit test, regression check, or `tests/sessions.json` entry before the fix when possible
- Shared logic, parsers, metric keys, defaults, storage merge behavior, plan/usage normalizers, and formatting helpers require Vitest unit tests
- DOM and visual behavior should be covered through `tests/checks.md`, `tests/sessions.json`, or a browser regression check; if only manual verification is possible, state why
- Documentation-only and mechanical config changes do not need new tests, but still require a clear verification note
- Never report `npm test` as meaningful if it passed only because no tests existed
- CI runs `typecheck` + `lint` + `test` + `build` on every PR — a change that breaks any of these does not merge

### 7. Verify Everything — No Regressions
This extension has tightly interconnected features (BiDi, themes, focus mode, streaming, fonts, chat width). A change to one can silently break others.

Before reporting any change as complete:
1. **Reproduce first**: If fixing a bug, confirm you can reproduce it before changing code
2. **Verify the fix**: Confirm the specific change works as intended
3. **Check for console errors**: Load the extension and confirm no errors in the console
4. **Cross-platform check**: If the change touches `src/shared/` or `src/content/`, test on all affected platforms (Claude, ChatGPT, Gemini)
5. **Regression sweep**: Spot-check related features:
   - Touched styling/themes → verify themes still apply correctly
   - Touched the MutationObserver or `patchAll()` → verify BiDi detection still fires
   - Touched selectors → verify focus mode still hides elements
   - Touched `applyStyles()` → verify typography, code blocks, chat width still work
6. **State what wasn't tested**: If you can't verify something (e.g., no browser access), explicitly say so — never assume a change is safe

### 8. Goal-Driven Execution
- Transform tasks into verifiable success criteria before starting
- For multi-step tasks, state a brief plan with verification steps:
  ```
  1. [Step] → verify: [check]
  2. [Step] → verify: [check]
  ```
- Loop until verified — don't report done based on assumption

## Project Overview

Chrome extension (Manifest V3, TypeScript) that provides Hebrew and Arabic-script BiDi text fixing, custom themes, focus mode, streaming smoothing, and consistent typography/layout styling across Claude, ChatGPT, and Gemini.

Marketing operations (store listing, launch copy, channel/metrics trackers, SEO strategy) live in `marketing/`, operated via the `/marketing` skill — agents draft; posting happens only with a fresh, explicit per-post confirmation (one yes = one post; protocol in `marketing/playbook.md` §h), and blocked platforms stay human-pasted.

## Architecture

TypeScript source lives in `src/`, bundled by esbuild (`node build.mjs`, or `npm run dev` for watch mode) into `dist/` — one IIFE bundle per entry plus generated CSS/HTML assets and a `__ALEPH_BUILD__` stamp exposed as `data-aleph-build` on `<html>`. `manifest.json` stays at the **repo root**; page HTML/CSS source lives beside its entry in `src/<page>/` and ships from `dist/`. The repo root remains the unpacked-extension directory (moving the manifest would change the extension ID and orphan user storage). **Never edit `dist/`** — it's gitignored build output. After editing `src/`, rebuild (or have watch running), then reload via the `aleph-reload` flow below.

**Extension structure:**

- `manifest.json` — MV3 manifest with commands (keyboard shortcut), service worker, popup, and content asset paths pointing into `dist/`
- `src/shared/` — cross-bundle modules: `platform` (PLATFORMS, `detectPlatform`, setting-key builders), `selectors` (SELECTORS per platform + `SelectorSet`), `themes` (THEMES + THEME_NAMES), `defaults` (DEFAULTS), `rtl` (the RTL script-letter regex — single source), `dates`, `format`, `metricKeys` (frozen metric-key strings/builders), `messages` (wire-shape types), `platformMeta`, `pricing`, `version`; `ui.css` is the shared page-UI primitive sheet imported by popup/settings/insights CSS
- `src/background/` (→ `dist/background.js`) — classic service worker (NOT module type — firebase compat needs `importScripts`). Boot order in `index.ts` is load-bearing: `importScripts` of `vendor/firebase/*` (root-absolute paths — the worker lives in `dist/`) → firebase init guard → `registerBackgroundListeners()`. MV3 requires every `chrome.*` listener registered in the worker's first synchronous turn, and esbuild hoists bundled imports above the entry's own statements — so all background submodules must be **define-only at import time**. Modules: `usage` (usage-day storage + serialized `updateUsageDay` queue/`enqueueUsageWork`, plus `readCombinedUsageDays` — the single chokepoint that overlays the synced remote cache onto local docs for every UI/remark read), `metrics` (provider metric collection/change tracking), `providerUsage` (tabless provider quota/plan refresh through host-permission fetches + `chrome.cookies`), `remarks` (remark engine), `cleanup`, `router` (all listener registrations incl. the message router), `sync` (`alephSync` cloud sync, schema v2: device-scoped usage rollups that ADD across devices, per-key-LWW `settings2` doc, seal-based v1 migration, dirty-key flush — see `docs/SYNC.md`; exported legacy merge helpers are unit-tested), `syncSchema` (pure sync helpers + storage-key constants, unit-tested)
- `src/content/` (→ `dist/content.js` + `dist/content.css`) — main content script/CSS at `document_idle`: `platform`, `selectors` (SEL), `settingsStore` (settings singleton), `bidi`, `latex`, `theme`, `styles` (`applyStyles()`), `focus`, `streaming`, `fonts`, `badge`, `index` (boot + MutationObserver + `patchAll()`). CSS source in `content.css` + `styles/*.css` — **rule order is behavior**; imports stay in section order, never alphabetized
- `src/tracker/` (→ `dist/insights-tracker.js`) — usage/insights tracking content script: `send`, `time`, `timing`, `messages`, `tokens`, `plans`, `modelCaps`, `usageChatgpt`/`usageGemini` (pure provider payload normalizers shared by background refresh), `platform`, `index`; `platformAdapters/` holds one `TrackerPlatformAdapter` per platform (selectors + timing/plan/modelCaps config) gathered in `TRACKER_ADAPTERS` (`satisfies Record<Platform, …>`), so the boot in `index.ts` is platform-agnostic. Provider usage polling does **not** run from content adapters; `src/background/providerUsage.ts` owns provider quota fetches.
- `src/popup/` — `meters` (pure meter/trend helpers, unit-tested), `insightsView`, `ui`, `index`; `src/settings/` — `controls`, `syncUi`, `index`; `src/insights/` — `subscriptions`, `charts`, `index`; `src/mini-game/` — `spawn` (owns game state), `snake`, `minesweeper`, `index`
- `tests/unit/` — Vitest specs (node env); `tests/rules/` — Firestore security-rules specs (own vitest config, run only via `npm run test:rules` inside the emulator — needs Java); `tests/sessions.json` — visual regression registry; `tests/checks.md` — browser check snippets
- Firebase config artifacts at the repo root: `firestore.rules`, `firestore.indexes.json`, `firebase.json`, `.firebaserc`
- Commands: `npm run build` / `npm run dev` (watch) / `npm test` (vitest) / `npm run typecheck` / `npm run lint` / `npm run check` (all four) / `npm run test:rules` (emulator rules tests) / `npm run deploy:rules` (rules gate + deploy to production — deploy rules BEFORE shipping a client that writes new cloud paths)

**TypeScript & lint policy** — strict tsconfig, **zero `tsc` errors repo-wide**. `any` is allowed only at commented boundaries: raw provider/storage JSON, the firebase compat globals, and the boot-gated `SEL` cast in `src/content/selectors.ts`. Types in `src/shared/messages.ts` and `metricKeys.ts` **describe** wire shapes and storage keys — never use a type change to alter what is actually sent or stored. ESLint runs syntactic rules only (typescript-eslint recommended, calibrated in `eslint.config.mjs`); type-aware lint is deferred deliberately — tsc strict is the type gate, and the codebase's fire-and-forget promise style + boundary `any`s would fight `no-floating-promises`/`no-unsafe-*`. CI (`.github/workflows/ci.yml`) runs typecheck + lint + test + build on every PR, plus a `rules-test` job (Java + Firestore emulator) for `firestore.rules`; publish (`publish.yml`) runs the typecheck/lint/test/build gates before zipping `dist/` but deliberately NOT the emulator job — the rules artifact is not in the CWS zip; its release path is `npm run deploy:rules`, which re-runs the emulator gate before deploying.

## Key Patterns

**Platform detection** — `detectPlatform(hostname)` in `src/shared/platform.ts`; each content bundle derives its own `PLATFORM` constant (`src/content/platform.ts`, `src/tracker/platform.ts`), honestly typed `Platform | null` — guard before indexing platform-keyed maps (narrowing doesn't reach into closures; capture or re-check locally). Each platform has its own selector set in `SELECTORS[platform]` (`src/shared/selectors.ts`) covering: text, editor, math, code, message, chatWidth, themeBg, themeText, themeInput, themeCode, themeSidebar, focusHide (categorized), streaming, messageWrapper, chatContainer.

**BiDi detection** — `hasRTL(el)` (`src/content/bidi.ts`) recursively walks childNodes, tests text nodes against the RTL script-letter regex (Hebrew and Arabic-script letters only), skips katex/mjx-container/code/pre. Sets `data-aleph-rtl="true"` on matching elements. Uses `unicode-bidi: plaintext` for better mixed RTL/LTR line handling. The regex has a **single source**: `src/shared/rtl.ts` (content and tracker both import it; `tests/checks.md` mirrors it — keep that copy in sync).

**Dynamic styles** — `applyStyles()` (`src/content/styles.ts`) builds a CSS string from current settings and injects it into `#aleph-dynamic-styles` style element. Covers themes (CSS custom properties on `:root`), typography, code blocks, chat width, message spacing.

**Settings** — Stored in `chrome.storage.sync`. Defaults defined in `DEFAULTS` (`src/shared/defaults.ts`); the content script reads them through the `settingsStore` singleton (`src/content/settingsStore.ts`). Live updates via `chrome.storage.onChanged` listener. Export/import via JSON.

**MutationObserver** — Watches `document.body` for `childList`, `subtree`, `characterData` changes. Filters out head/style mutations. Reactive scheduling (`makeMutationScheduler` in `src/content/rescan.ts`): 120ms quiet-window debounce with a 500ms max-wait that cannot be starved by sustained churn; scanners drain 12ms-budgeted slices from their own pending queues (`makePendingQueue`), resumed by a 30ms continuation timer; a 500ms self-canceling drain revisits observer-invisible work (streaming-parked messages, hint expiry); one 30s attribute-recovery heartbeat.

**Font loading** — `GOOGLE_FONTS` map covers Hebrew, Arabic-script, general text, and code fonts (Fira Code, JetBrains Mono, etc.). `loadFont()` injects a `<link>` tag to Google Fonts API on demand.

**Color scheme** — `updateColorScheme()` sets `<meta name="color-scheme">` and `document.documentElement.style.colorScheme` based on the active theme's luminance, so browser UI (scrollbars, form controls) matches.

**Badge** — Content script sends `{ type: "badge", count }` to service worker (`src/content/badge.ts` → `src/background/router.ts`). Count reflects active features (BiDi, theme, focus, streaming, fonts, width). Shows "OFF" when platform is disabled. Message shapes are typed in `src/shared/messages.ts` — the types document the wire, senders define it.

**Keyboard shortcut** — `Alt+Shift+A` toggles the extension on/off for the current platform. Handled via `chrome.commands` API → service worker → content script message.

## Theme System

Fourteen presets defined in `THEMES` (`src/shared/themes.ts`): `warmDark`, `coolDark`, `paperLight`, `highContrast`, `midnight`, `nord`, `dracula`, `solarized`, `rosePine`, `catppuccin`, `gruvbox`, `oneDark`, `tokyoNight`, `githubDark`. Each defines: `bg`, `bgSecondary`, `bgTertiary`, `text`, `textMuted`, `accent`, `border`, `codeBg`, `codeBorder`, `inputBg`. Applied via CSS custom properties (`--aleph-bg`, `--aleph-accent`, etc.) on `[data-aleph-theme]`.

**Per-platform themes** — `themeClaude`, `themeChatgpt`, `themeGemini` settings override the global `theme` per platform. `getActiveThemeName()` resolves the platform-specific theme, falling back to global.

## Streaming Animation System

When "Smooth streaming" is enabled, platform default streaming animations (cursors, typing indicators, shimmer effects) are hidden via CSS attribute selectors targeting `[data-aleph-stream-enabled][data-aleph-platform]`. Five animation modes selectable via `streamAnimation` setting:

- `fadeIn` — gentle opacity + translateY(4px) fade-in (default)
- `typewriter` — clip-path reveal with stepped timing
- `slideUp` — larger translateY(12px) with spring easing
- `glow` — accent-colored text-shadow that fades out
- `none` — suppresses platform default only, no custom animation

Animation mode stored as `data-aleph-stream-anim` attribute on `<html>`. CSS in `src/content/styles/streaming.css` matches `[data-aleph-stream-anim="<mode>"]` for each variant. `patchAll()` also ensures this attribute stays set as a recovery mechanism.

## Focus Mode

Hides upgrade banners, promos, and UI clutter via `data-aleph-hidden` attribute + `display: none !important`. Uses both CSS selector matching and text-based fallback matching on ChatGPT for elements with unstable class names.

**Granular categories** — `focusHide` selectors are structured as `{ upgrade: [...], chips: [...], promos: [...] }`. Each category can be independently toggled via `focusHideUpgrade`, `focusHideChips`, `focusHidePromos` settings.

## Testing Notes

- **Cannot access `chrome.storage.sync` from page context** — use DOM attribute injection and CSS for manual testing
- ChatGPT frequently changes its DOM class names; focus mode uses text-matching fallback
- Claude on paid plans has no upgrade elements to hide (expected behavior)
- Gemini suggestion chips use `<intent-card>` custom elements inside `.card-container`
- Gemini uses TrustedHTML policy — cannot set innerHTML from page context, use Quill API or insertText

## Test Registry

`tests/sessions.json` tracks known problematic chat sessions for visual regression testing. Each entry has a platform, URL, bug description, category, and an array of checks to run.

**Auto-update**: When you discover or fix a visual bug during a conversation:
1. Read `tests/sessions.json`
2. If discovering a new bug: add an entry with the session URL, platform, category, description, and checks
3. If fixing a known bug: update its `status` to `"fixed"`
4. Write the updated file

**Valid check IDs**: `rtl-direction`, `math-ltr-isolation`, `no-console-errors`, `latex-rendered`, `theme-applied`, `focus-hidden`, `streaming-attrs`, `selectors-match`, `composer-bidi-performance`, `platform-contract`

**Valid categories**: `bidi-text`, `bidi-math`, `latex-rendering`, `theme`, `streaming`, `focus-mode`, `selector-breakage`, `general`

## Pre-Push Regression Tests

When the user asks to push commits, spawn the `regression-tester` agent:

```
Agent({
  subagent_type: "regression-tester",
  description: "Pre-push regression sweep",
  prompt: "Run regression tests.\n\nMode: full\nDiscover: false\nUpdate registry: false\n\nContext: Pre-push validation. Report pass/fail only."
})
```

- If ALL pass: proceed with `git push`
- If ANY fail: report which sessions/checks failed, ask user whether to push anyway or investigate

### Check reference

Check implementations (JS snippets) live in `tests/checks.md`. Valid check IDs:

**`rtl-direction`** — RTL-script elements have `data-aleph-rtl="true"` and computed `direction: rtl`. SKIPs when the conversation has no RTL-script text or messages haven't rendered; FAILs only when RTL text is present but unmarked.

**`math-ltr-isolation`** — `.katex` and `mjx-container` maintain `direction: ltr` inside RTL containers.

**`no-console-errors`** — No Aleph-related error-level console messages.

**`latex-rendered`** — `.katex` elements exist, no `.katex-error` spans.

**`theme-applied`** — CSS custom properties (`--aleph-bg`, `--aleph-text`, `--aleph-accent`, `--aleph-border`) present when theme is set.

**`focus-hidden`** — `[data-aleph-hidden]` elements have `display: none`.

**`streaming-attrs`** — `data-aleph-stream-enabled` and `data-aleph-stream-anim` attributes on `<html>`.

**`selectors-match`** — `[data-aleph-platform]` always required; `[data-aleph-rtl]` only when the conversation contains RTL-script text; `[data-aleph-theme]` only when a theme is set.

**`composer-bidi-performance`** — async, ~12s, requires a visible tab: types Hebrew into the composer (after a warmup that absorbs the platform's first-input lazy-init burst) and FAILs on the composer feedback-loop signature (*sustained* composer-subtree churn across both halves of a no-input silence window, repeated/long silence longtasks, longtask churn while typing) or on broken composer RTL behavior (Hebrew block not `direction: rtl`).

**`platform-contract`** — reads the `data-aleph-contract` / `data-aleph-contract-missing` attributes the tracker's drift self-check publishes (`src/tracker/contract.ts` + `src/shared/contract.ts`). FAILs naming any required detection anchor (the account container, plus Gemini's tier badge when the stored plan is paid) that no longer resolves; SKIPs when the tracker hasn't evaluated yet or no anchor resolves at all (off-app / logged-out page). Surfaces a third-party DOM rework (like Gemini's tier-badge move) immediately instead of detection silently returning nothing.

## Common Tasks

**Adding a new theme**: Add the entry to `THEMES` and its label to `THEME_NAMES` in `src/shared/themes.ts` (the settings page builds its per-platform dropdowns from `THEME_NAMES`), and add a swatch button in `src/popup/popup.html`'s theme grid (static HTML).

**Adding a new platform**: Add it to `PLATFORMS`/`detectPlatform` in `src/shared/platform.ts`, add a full selector set in `src/shared/selectors.ts` (including categorized `focusHide` and `chatContainer`), add `enable<Platform>` and `theme<Platform>` to `DEFAULTS` in `src/shared/defaults.ts`, add popup toggles and theme override dropdown, add a content_scripts match in `manifest.json`, add a tracker adapter in `src/tracker/platformAdapters/` registered in `TRACKER_ADAPTERS` (the `satisfies Record<Platform, TrackerPlatformAdapter>` check makes tsc fail until it exists), and add any tabless quota/plan refresh support to `src/background/providerUsage.ts` with unit coverage.

**Updating selectors**: When a platform changes its DOM, update the relevant arrays in `SELECTORS[platform]` in `src/shared/selectors.ts`. Test by querying `document.querySelectorAll(selector)` in the browser console on that platform.

**Export/import settings**: JSON format matching the `DEFAULTS` keys. Import validates keys against `DEFAULTS` to prevent injection of unknown settings.

**Reloading the extension after code changes** — the extension runs the **built** bundles in `dist/`, not `src/` directly, so the reload procedure is THREE steps and the build step is mandatory (skipping it silently reloads stale code and invalidates any verification):

1. **Rebuild**: `npm run build` (skip only if you started `npm run dev` watch in this session and it is still running).
2. **Reload**: the content bundle exposes the extension ID as `data-aleph-ext-id` on `<html>`; the background bundle has an `onMessageExternal` listener for `{type: "aleph-reload"}` that calls `chrome.runtime.reload()`. From any supported platform page (Claude, ChatGPT, Gemini), run in the browser console or via `javascript_tool`:
```javascript
(() => {
  const extId = document.documentElement.getAttribute('data-aleph-ext-id');
  if (!extId) return 'FAIL: extension ID not found';
  chrome.runtime.sendMessage(extId, {type: 'aleph-reload'});
  return 'OK: reload triggered for ' + extId;
})()
```
3. **Refresh the page** to load the new content scripts, then confirm `document.documentElement.getAttribute('data-aleph-build')` matches the build stamp printed by `npm run build` before treating any verification as meaningful. Wait ~2s between triggering the reload and refreshing: a refresh that races the extension restart skips the manifest CSS injection (document_start) while the JS still injects at document_idle — leaving a fresh stamp but no `content.css`, which fails `rtl-direction` spuriously. If CSS-dependent checks fail right after a reload, refresh once more before investigating.
