# Aleph — AI Chat Styler

## Project Overview

Chrome extension (Manifest V3) that provides Hebrew BiDi text fixing, custom themes, focus mode, streaming smoothing, and consistent typography/layout styling across Claude, ChatGPT, and Gemini.

## Architecture

Extension structure — no build step, plain JS/CSS/HTML:

- manifest.json — MV3 manifest, targets claude.ai, chatgpt.com, chat.openai.com, gemini.google.com
- content.js — Main content script. Platform detection, BiDi engine, theme injection, focus mode, streaming smoothing, style injector.
- content.css — Static CSS rules for BiDi, streaming animations, focus mode hiding, theme transitions, platform-specific structural fixes
- popup.html / popup.css / popup.js — Settings popup UI with toggle switches, theme grid, range sliders

## Key Patterns

Platform detection — PLATFORM constant set from location.hostname. Each platform has its own selector set in SELECTORS[platform].

BiDi detection — hasHebrew(el) recursively walks childNodes, tests text nodes against Hebrew Unicode range, skips katex/mjx-container/code/pre.

Dynamic styles — applyStyles() builds a CSS string from current settings and injects into #aleph-dynamic-styles.

Settings — Stored in chrome.storage.sync. Live updates via chrome.storage.onChanged listener.

MutationObserver — Watches document.body for childList, subtree, characterData changes. Debounced at 120ms + 3s interval fallback.

## Theme System

Five presets: warmDark, coolDark, paperLight, highContrast, midnight. Applied via CSS custom properties on [data-aleph-theme].

## Focus Mode

Hides upgrade banners and clutter via data-aleph-hidden attribute. Uses CSS selector matching plus text-based fallback on ChatGPT.

## Common Tasks

Adding a theme: Add to THEMES in content.js + swatch in popup.html.
Adding a platform: Add hostname check, SELECTORS entry, enable toggle, manifest match.
Updating selectors: Update SELECTORS[platform] arrays when a platform changes its DOM.
