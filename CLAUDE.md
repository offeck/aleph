# Aleph — AI Chat Styler

## Project Overview

Chrome extension (Manifest V3) that provides Hebrew BiDi text fixing, custom themes, focus mode, streaming smoothing, and consistent typography/layout styling across Claude, ChatGPT, and Gemini.

## Architecture

**Extension structure** — no build step, plain JS/CSS/HTML:

- `manifest.json` — MV3 manifest, targets `claude.ai`, `chatgpt.com`, `chat.openai.com`, `gemini.google.com`
- `content.js` — Main content script. Platform detection, BiDi engine, theme injection, focus mode, streaming smoothing, style injector. Runs at `document_idle`.
- `content.css` — Static CSS rules for BiDi, streaming animations, focus mode hiding, theme transitions, platform-specific structural fixes
- `popup.html` / `popup.css` / `popup.js` — Settings popup UI with toggle switches, theme grid, range sliders

## Key Patterns

**Platform detection** — `PLATFORM` constant set from `location.hostname`. Each platform has its own selector set in `SELECTORS[platform]` covering: text, editor, math, code, message, chatWidth, themeBg, themeText, themeInput, themeCode, themeSidebar, focusHide, streaming, messageWrapper.

**BiDi detection** — `hasHebrew(el)` recursively walks childNodes, tests text nodes against `/[֐-׿]/`, skips katex/mjx-container/code/pre. Sets `data-aleph-rtl="true"` on matching elements.

**Dynamic styles** — `applyStyles()` builds a CSS string from current settings and injects it into `#aleph-dynamic-styles` style element. Covers themes (CSS custom properties on `:root`), typography, code blocks, chat width, message spacing.

**Settings** — Stored in `chrome.storage.sync`. Defaults defined in `DEFAULTS` object. Live updates via `chrome.storage.onChanged` listener.

**MutationObserver** — Watches `document.body` for `childList`, `subtree`, `characterData` changes. Debounced at 120ms + 3s interval fallback.

## Theme System

Ten presets defined in `THEMES` object: `warmDark`, `coolDark`, `paperLight`, `highContrast`, `midnight`, `nord`, `dracula`, `solarized`, `rosePine`, `catppuccin`. Each defines: `bg`, `bgSecondary`, `bgTertiary`, `text`, `textMuted`, `accent`, `border`, `codeBg`, `codeBorder`, `inputBg`. Applied via CSS custom properties (`--aleph-bg`, `--aleph-accent`, etc.) on `[data-aleph-theme]`.

## Streaming Animation System

When "Smooth streaming" is enabled, platform default streaming animations (cursors, typing indicators, shimmer effects) are hidden via CSS attribute selectors targeting `[data-aleph-stream-enabled][data-aleph-platform]`. Five animation modes selectable via `streamAnimation` setting:

- `fadeIn` — gentle opacity + translateY(4px) fade-in (default)
- `typewriter` — clip-path reveal with stepped timing
- `slideUp` — larger translateY(12px) with spring easing
- `glow` — accent-colored text-shadow that fades out
- `none` — suppresses platform default only, no custom animation

Animation mode stored as `data-aleph-stream-anim` attribute on `<html>`. CSS in `content.css` matches `[data-aleph-stream-anim="<mode>"]` for each variant.

## Focus Mode

Hides upgrade banners, promos, and UI clutter via `data-aleph-hidden` attribute + `display: none !important`. Uses both CSS selector matching (`SEL.focusHide`) and text-based fallback matching on ChatGPT for elements with unstable class names.

## Testing Notes

- **Cannot access `chrome.storage.sync` from page context** — use DOM attribute injection and CSS for manual testing
- ChatGPT frequently changes its DOM class names; focus mode uses text-matching fallback
- Claude on paid plans has no upgrade elements to hide (expected behavior)
- Gemini suggestion chips only appear on home page, not inside conversations

## Common Tasks

**Adding a new theme**: Add entry to `THEMES` object in `content.js`, add swatch button in `popup.html` theme grid.

**Adding a new platform**: Add hostname check in platform detection, add full selector set in `SELECTORS`, add `enable<Platform>` to `DEFAULTS` and popup toggles, add content_scripts match in `manifest.json`.

**Updating selectors**: When a platform changes its DOM, update the relevant arrays in `SELECTORS[platform]`. Test by querying `document.querySelectorAll(selector)` in the browser console on that platform.
