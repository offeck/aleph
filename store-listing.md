# Chrome Web Store Listing Content

Use this file as a reference when filling in the Developer Dashboard.
URL: https://chrome.google.com/webstore/devconsole

---

## Account Tab

**Contact email:** offeck100@gmail.com
(Click verify and check your inbox)

---

## Store Listing Tab

**Language:** English

**Category:** Accessibility

**Detailed description (copy-paste this):**

Aleph is a Chrome extension that fixes Hebrew and Arabic-script RTL text rendering across AI chat platforms — Claude, ChatGPT, and Gemini.

Features:
- Hebrew, Arabic, Persian, and Urdu BiDi text fixing with automatic RTL detection
- 10 beautiful themes (Nord, Dracula, Catppuccin, Rose Pine, and more) with per-platform overrides
- Focus mode that hides upgrade banners, promo chips, and UI clutter
- Smooth streaming animations (fade-in, typewriter, slide-up, glow)
- Custom typography with Google Fonts support for both text and code
- Adjustable chat width and message spacing
- Keyboard shortcut (Alt+Shift+A) to toggle on/off
- Export/import settings as JSON

Works on claude.ai, chatgpt.com, and gemini.google.com. No data collection, no analytics, no external requests except optional Google Fonts loading.

**Screenshot:** Take a 1280x800 screenshot of the extension in action:
1. Open claude.ai with a Hebrew or Arabic-script conversation
2. Press Win+Shift+S
3. Select the browser content area
4. Save as PNG, upload to the Dashboard

---

## Privacy Practices Tab

**Single purpose description:**
Fixes Hebrew and Arabic-script RTL text direction and provides visual customization (themes, typography, focus mode) on AI chat platforms.

**Host permission justification:**
The extension requires host permissions for claude.ai, chatgpt.com, chat.openai.com, and gemini.google.com to inject content scripts that detect Hebrew and Arabic-script text and apply BiDi fixes, custom themes, and UI modifications directly on these pages. No data is read or transmitted from these sites.

**Remote code justification:**
The extension optionally loads Google Fonts (fonts.googleapis.com) when the user selects a custom font in settings. This is the only remote resource loaded, and it only occurs on explicit user action. No other remote code is executed.

**Are you using remote code?** Yes

**Data usage compliance:** Check the certification checkbox.

**Data disclosure:** The extension does NOT collect or transmit any user data. Select "No" for all data types.
