# Aleph — AI Chat Styler

## Project Overview

Chrome extension (Manifest V3) that provides Hebrew BiDi text fixing, custom themes, focus mode, streaming smoothing, and consistent typography/layout styling across Claude, ChatGPT, and Gemini.

## Architecture

**Extension structure** — no build step, plain JS/CSS/HTML:

- `manifest.json` — MV3 manifest with commands (keyboard shortcut) and service worker
- `background.js` — Service worker for toolbar badge updates and keyboard shortcut handling
- `content.js` — Main content script. Platform detection, BiDi engine, theme injection, focus mode, streaming smoothing, font loading, color-scheme, style injector. Runs at `document_idle`.
- `content.css` — Static CSS rules for BiDi, streaming animations, focus mode hiding, theme transitions, platform-specific structural fixes
- `popup.html` / `popup.css` / `popup.js` — Settings popup UI with toggle switches, theme grid, per-platform theme overrides, focus mode categories, range sliders, export/import

## Key Patterns

**Platform detection** — `PLATFORM` constant set from `location.hostname`. Each platform has its own selector set in `SELECTORS[platform]` covering: text, editor, math, code, message, chatWidth, themeBg, themeText, themeInput, themeCode, themeSidebar, focusHide (categorized), streaming, messageWrapper, chatContainer.

**BiDi detection** — `hasHebrew(el)` recursively walks childNodes, tests text nodes against `/[֐-׿]/`, skips katex/mjx-container/code/pre. Sets `data-aleph-rtl="true"` on matching elements. Uses `unicode-bidi: plaintext` for better mixed RTL/LTR line handling.

**Dynamic styles** — `applyStyles()` builds a CSS string from current settings and injects it into `#aleph-dynamic-styles` style element. Covers themes (CSS custom properties on `:root`), typography, code blocks, chat width, message spacing.

**Settings** — Stored in `chrome.storage.sync`. Defaults defined in `DEFAULTS` object. Live updates via `chrome.storage.onChanged` listener. Export/import via JSON.

**MutationObserver** — Watches `document.body` for `childList`, `subtree`, `characterData` changes. Filters out head/style mutations. Debounced at 120ms + 3s interval fallback.

**Font loading** — `GOOGLE_FONTS` map covers Hebrew fonts (Rubik, Heebo, etc.) and code fonts (Fira Code, JetBrains Mono, etc.). `loadFont()` injects a `<link>` tag to Google Fonts API on demand.

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

## Common Tasks

**Adding a new theme**: Add entry to `THEMES` object in `content.js`, add swatch button in `popup.html` theme grid, add to `THEME_NAMES` in `popup.js`.

**Adding a new platform**: Add hostname check in platform detection, add full selector set in `SELECTORS` (including categorized `focusHide` and `chatContainer`), add `enable<Platform>` and `theme<Platform>` to `DEFAULTS`, add popup toggles and theme override dropdown, add content_scripts match in `manifest.json`.

**Updating selectors**: When a platform changes its DOM, update the relevant arrays in `SELECTORS[platform]`. Test by querying `document.querySelectorAll(selector)` in the browser console on that platform.

**Export/import settings**: JSON format matching the `DEFAULTS` keys. Import validates keys against `DEFAULTS` to prevent injection of unknown settings.
