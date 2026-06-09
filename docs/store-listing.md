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
- 14 beautiful themes (Nord, Dracula, Catppuccin, Rose Pine, and more) with per-platform overrides
- Focus mode that hides upgrade banners, promo chips, and UI clutter
- Smooth streaming animations (fade-in, typewriter, slide-up, glow)
- Custom typography with Google Fonts support for both text and code
- Adjustable chat width and message spacing
- Local usage insights with provider quota/plan snapshots
- Optional Google sign-in for cross-device settings and usage sync
- Keyboard shortcut (Alt+Shift+A) to toggle on/off
- Export/import settings as JSON

Works on claude.ai, chatgpt.com, and gemini.google.com. No conversation content is collected, no analytics are sent to Aleph, and cloud sync is optional.

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
The extension requires host permissions for claude.ai, chatgpt.com, chat.openai.com, and gemini.google.com to inject content scripts that detect Hebrew and Arabic-script text and apply BiDi fixes, custom themes, usage tracking, and UI modifications directly on these pages. The background service worker also uses these same provider domains to refresh the user's own plan and quota metadata for the popup insights.

**Remote code justification:**
No remotely hosted JavaScript or executable code is loaded. Firebase, KaTeX, and all extension scripts are bundled locally. Optional Google Fonts stylesheets may be requested only when the user selects a custom font in settings.

**Are you using remote code?** No

**Data usage compliance:** Check the certification checkbox.

**Data disclosure:** Disclose website content limited to on-page text needed for local BiDi/usage processing, user activity limited to usage insights (stored locally; daily summaries sync to the user's private Firebase account only with optional sign-in, retained 400 days), authentication information limited to optional Google sign-in email, and user settings for optional sync. Conversation content is not stored or synced.
