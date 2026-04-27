# Aleph (א) — AI Chat Styler

A Chrome extension that fixes Hebrew/English/Math bidirectional text rendering and gives you consistent styling controls across **Claude**, **ChatGPT**, and **Gemini**.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-blue?logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-green)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow)

## The problem

AI chat platforms render Hebrew text poorly. When Hebrew mixes with English words or math expressions, the bidirectional text algorithm breaks — words appear in the wrong order, math equations flip, and lists point the wrong way. Each platform (Claude, ChatGPT, Gemini) has different DOM structures, making a universal fix non-trivial.

On top of that, each platform uses different fonts, sizes, and spacing — making it jarring to switch between them.

## What Aleph does

**BiDi fixing** — Automatically detects Hebrew content in AI responses and input boxes, applies correct RTL direction while keeping math (KaTeX, MathJax) and code blocks in LTR. Works in real-time as responses stream in.

**Style unification** — A popup settings panel lets you override typography, code block appearance, and layout width across all three platforms:

- **Font family** — Choose a Hebrew-friendly font (Rubik, Heebo, Assistant, Noto Sans Hebrew, etc.) that applies everywhere
- **Font size & line height** — Adjust readability to your preference
- **Paragraph spacing** — Control density of response text
- **Code block font & size** — Pick your preferred monospace font
- **Chat width** — Widen the narrow default conversation column

All settings sync across devices via `chrome.storage.sync`.

## Installation

1. Clone or download this repository
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked**
5. Select the `aleph` folder

The א icon will appear in your extensions bar. Click it to open settings.

## Supported platforms

| Platform | URL | BiDi fix | Style overrides |
|----------|-----|----------|-----------------|
| Claude | `claude.ai` | ✓ | ✓ |
| ChatGPT | `chatgpt.com` | ✓ | ✓ |
| Gemini | `gemini.google.com` | ✓ | ✓ |

## How it works

The extension injects a content script on each supported platform. It:

1. **Detects the platform** from the hostname and loads platform-specific DOM selectors
2. **Observes DOM mutations** via `MutationObserver` to catch streaming responses in real-time
3. **Scans text nodes** for Hebrew characters (Unicode range `U+0590–U+05FF`)
4. **Applies `data-aleph-rtl="true"`** to elements containing Hebrew, which triggers CSS rules for RTL direction
5. **Injects dynamic CSS** based on your saved settings for fonts, sizes, and layout

Math containers (`.katex`, `mjx-container`) and code blocks are explicitly isolated to stay LTR regardless of surrounding text direction.

## Project structure

```
aleph/
├── manifest.json     # Chrome MV3 manifest — targets all 3 platforms
├── content.js        # Main content script (platform detection, BiDi engine, style injector)
├── content.css       # Static CSS rules (RTL, math isolation, code isolation)
├── popup.html        # Settings popup markup
├── popup.js          # Popup logic (reads/writes chrome.storage.sync)
├── popup.css         # Popup styling
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Settings reference

| Setting | Range | Default | What it does |
|---------|-------|---------|--------------|
| Platform toggles | on/off | all on | Enable/disable per platform |
| BiDi fix | on/off | on | Hebrew RTL auto-detection |
| Font family | dropdown | platform default | Override response text font |
| Font size | 0–24 px | 0 (no override) | Override response text size |
| Line height | 0–2.4 | 0 (no override) | Override line spacing |
| Paragraph spacing | 0–32 px | 0 (no override) | Space between paragraphs |
| Code font | dropdown | platform default | Override code block font |
| Code font size | 0–22 px | 0 (no override) | Override code block text size |
| Chat width | 0–1600 px | 0 (no override) | Override max conversation width |

Setting a value to 0 (or empty for dropdowns) means "don't override — use the platform's default."

## Contributing

PRs welcome. The most common maintenance need is updating platform selectors when Claude/ChatGPT/Gemini change their DOM structure. If you notice the extension stopped working on a platform, check the `SELECTORS` object in `content.js`.

## License

MIT
