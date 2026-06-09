# Privacy Policy — Aleph AI Chat Styler

**Last updated:** June 10, 2026

## What data does Aleph collect?

### Without sign-in (default)
Aleph stores your preferences (theme, fonts, BiDi settings) locally in your browser via `chrome.storage.sync`. Usage insights (time spent, message counts, token estimates, provider plan/limit snapshots per platform) are stored locally via `chrome.storage.local`.

Aleph may contact the supported AI providers directly from the extension background worker to refresh your own plan and quota metadata for Claude, ChatGPT, and Gemini. These requests go only to the provider domains listed in the extension permissions and use your existing browser session. Aleph does not send this data to Aleph servers.

### With Google sign-in (optional)
If you choose to sign in with Google, Aleph stores:
- **Email address**: Used solely to identify your account for cross-device sync.
- **Usage insights**: Daily usage summaries are synced to Google Firebase Firestore so you can access them on other devices — per platform: active time (including an hourly breakdown in your local time, with your timezone offset), message and send counts (including sends per hour), and token/media estimates. Each of your devices syncs its own daily summary under a random device identifier so totals add up correctly across devices. Provider plan/limit snapshots stay local and are not synced; only the detected subscription plan (name/price) syncs.
- **Settings preferences**: Your theme, font, and feature settings are synced to Firestore (only known Aleph settings keys, nothing else).

All synced data is stored under a private, user-scoped Firestore path that only you can access (enforced by the Firebase security rules versioned in this repository as `firestore.rules`). Synced usage data older than 400 days is deleted automatically.

## What data does Aleph NOT collect?
- Conversation content (your chats are never read or stored)
- Browsing history
- Passwords or credentials
- Payment information
- Data from any website other than claude.ai, chatgpt.com, chat.openai.com, and gemini.google.com

## Third-party services
- **Google Firebase**: Used for optional authentication and data sync. Subject to [Google's Privacy Policy](https://policies.google.com/privacy).
- **Google Fonts**: Loaded only when you select a custom font in settings.
- **Claude, ChatGPT/OpenAI, and Gemini/Google**: Contacted only on their own domains to read your current plan and quota metadata for the popup insights.

## Data deletion
You can sign out at any time from Settings, which stops all cloud sync. To delete your synced data, sign out and your local data remains intact. Synced usage data expires from the cloud automatically after 400 days. Contact offeck100@gmail.com to request full deletion of cloud data.

## Contact
For privacy questions, contact offeck100@gmail.com.
