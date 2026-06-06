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

### 7. Verify Everything — No Regressions
This extension has tightly interconnected features (BiDi, themes, focus mode, streaming, fonts, chat width). A change to one can silently break others.

Before reporting any change as complete:
1. **Reproduce first**: If fixing a bug, confirm you can reproduce it before changing code
2. **Verify the fix**: Confirm the specific change works as intended
3. **Check for console errors**: Load the extension and confirm no errors in the console
4. **Cross-platform check**: If the change touches shared code or `content.js`/`content.css`, test on all affected platforms (Claude, ChatGPT, Gemini)
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

Chrome extension (Manifest V3) that provides Hebrew and Arabic-script BiDi text fixing, custom themes, focus mode, streaming smoothing, and consistent typography/layout styling across Claude, ChatGPT, and Gemini.

## Architecture

> **TypeScript migration in progress** (see `MIGRATION.md` + PR #2). Source now lives in `src/` as TypeScript, bundled by esbuild (`node build.mjs`, or `npm run dev` for watch mode) into `dist/` — one IIFE bundle per entry. `manifest.json` and the HTML pages stay at the **repo root** and point into `dist/`; the repo root remains the unpacked-extension directory (moving the manifest would change the extension ID and orphan user storage). **Never edit `dist/`** — it's gitignored build output. After editing `src/`, rebuild (or have watch running), then reload via the `aleph-reload` flow below.

**Extension structure:**

- `manifest.json` — MV3 manifest with commands (keyboard shortcut) and service worker; script paths point into `dist/`
- `src/background/` (→ `dist/background.js`) — Service worker: badge updates, keyboard shortcut, insights storage, cloud sync (firebase via `importScripts` of `vendor/firebase/`)
- `src/content/` (→ `dist/content.js`) — Main content script. Platform detection, BiDi engine, theme injection, focus mode, streaming smoothing, font loading, color-scheme, style injector. Runs at `document_idle`.
- `src/tracker/` (→ `dist/insights-tracker.js`) — usage/insights tracking content script
- `src/mini-game/`, `src/popup/`, `src/settings/`, `src/insights/` — remaining entries, same pattern
- `content.css` — Static CSS rules for BiDi, streaming animations, focus mode hiding, theme transitions, platform-specific structural fixes
- `popup.html` / `popup.css` — Settings popup UI with toggle switches, theme grid, per-platform theme overrides, focus mode categories, range sliders, export/import
- `tests/sessions.json` — Visual regression test registry. Stores known problematic chat sessions with platform, URL, bug description, and checks to run.
- Commands: `npm run build` / `npm run dev` (watch) / `npm test` (vitest) / `npm run typecheck`

## Key Patterns

**Platform detection** — `PLATFORM` constant set from `location.hostname`. Each platform has its own selector set in `SELECTORS[platform]` covering: text, editor, math, code, message, chatWidth, themeBg, themeText, themeInput, themeCode, themeSidebar, focusHide (categorized), streaming, messageWrapper, chatContainer.

**BiDi detection** — `hasRTL(el)` recursively walks childNodes, tests text nodes against the RTL script-letter regex (Hebrew and Arabic-script letters only), skips katex/mjx-container/code/pre. Sets `data-aleph-rtl="true"` on matching elements. Uses `unicode-bidi: plaintext` for better mixed RTL/LTR line handling. Keep the regex pattern in `content.js` and `insights-tracker.js` in sync.

**Dynamic styles** — `applyStyles()` builds a CSS string from current settings and injects it into `#aleph-dynamic-styles` style element. Covers themes (CSS custom properties on `:root`), typography, code blocks, chat width, message spacing.

**Settings** — Stored in `chrome.storage.sync`. Defaults defined in `DEFAULTS` object. Live updates via `chrome.storage.onChanged` listener. Export/import via JSON.

**MutationObserver** — Watches `document.body` for `childList`, `subtree`, `characterData` changes. Filters out head/style mutations. Debounced at 120ms + 3s interval fallback.

**Font loading** — `GOOGLE_FONTS` map covers Hebrew, Arabic-script, general text, and code fonts (Fira Code, JetBrains Mono, etc.). `loadFont()` injects a `<link>` tag to Google Fonts API on demand.

**Color scheme** — `updateColorScheme()` sets `<meta name="color-scheme">` and `document.documentElement.style.colorScheme` based on the active theme's luminance, so browser UI (scrollbars, form controls) matches.

**Badge** — Content script sends `{ type: "badge", count }` to service worker. Count reflects active features (BiDi, theme, focus, streaming, fonts, width). Shows "OFF" when platform is disabled.

**Keyboard shortcut** — `Alt+Shift+A` toggles the extension on/off for the current platform. Handled via `chrome.commands` API → service worker → content script message.

## Theme System

Ten presets defined in `THEMES` object: `warmDark`, `coolDark`, `paperLight`, `highContrast`, `midnight`, `nord`, `dracula`, `solarized`, `rosePine`, `catppuccin`. Each defines: `bg`, `bgSecondary`, `bgTertiary`, `text`, `textMuted`, `accent`, `border`, `codeBg`, `codeBorder`, `inputBg`. Applied via CSS custom properties (`--aleph-bg`, `--aleph-accent`, etc.) on `[data-aleph-theme]`.

**Per-platform themes** — `themeClaude`, `themeChatgpt`, `themeGemini` settings override the global `theme` per platform. `getActiveThemeName()` resolves the platform-specific theme, falling back to global.

## Streaming Animation System

When "Smooth streaming" is enabled, platform default streaming animations (cursors, typing indicators, shimmer effects) are hidden via CSS attribute selectors targeting `[data-aleph-stream-enabled][data-aleph-platform]`. Five animation modes selectable via `streamAnimation` setting:

- `fadeIn` — gentle opacity + translateY(4px) fade-in (default)
- `typewriter` — clip-path reveal with stepped timing
- `slideUp` — larger translateY(12px) with spring easing
- `glow` — accent-colored text-shadow that fades out
- `none` — suppresses platform default only, no custom animation

Animation mode stored as `data-aleph-stream-anim` attribute on `<html>`. CSS in `content.css` matches `[data-aleph-stream-anim="<mode>"]` for each variant. `patchAll()` also ensures this attribute stays set as a recovery mechanism.

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

**Valid check IDs**: `rtl-direction`, `math-ltr-isolation`, `no-console-errors`, `latex-rendered`, `theme-applied`, `focus-hidden`, `streaming-attrs`, `selectors-match`

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

## Common Tasks

**Adding a new theme**: Add entry to `THEMES` object in `content.js`, add swatch button in `popup.html` theme grid, add to `THEME_NAMES` in `popup.js`.

**Adding a new platform**: Add hostname check in platform detection, add full selector set in `SELECTORS` (including categorized `focusHide` and `chatContainer`), add `enable<Platform>` and `theme<Platform>` to `DEFAULTS`, add popup toggles and theme override dropdown, add content_scripts match in `manifest.json`.

**Updating selectors**: When a platform changes its DOM, update the relevant arrays in `SELECTORS[platform]`. Test by querying `document.querySelectorAll(selector)` in the browser console on that platform.

**Export/import settings**: JSON format matching the `DEFAULTS` keys. Import validates keys against `DEFAULTS` to prevent injection of unknown settings.

**Reloading the extension after code changes**: `content.js` exposes the extension ID as `data-aleph-ext-id` on `<html>`. `background.js` has an `onMessageExternal` listener for `{type: "aleph-reload"}` that calls `chrome.runtime.reload()`. From any supported platform page (Claude, ChatGPT, Gemini), run in the browser console or via `javascript_tool`:
```javascript
(() => {
  const extId = document.documentElement.getAttribute('data-aleph-ext-id');
  if (!extId) return 'FAIL: extension ID not found';
  chrome.runtime.sendMessage(extId, {type: 'aleph-reload'});
  return 'OK: reload triggered for ' + extId;
})()
```
After reload, refresh the page to load the new content scripts.
