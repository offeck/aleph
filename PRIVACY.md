# Privacy Policy — Aleph AI Chat Styler

**Last updated:** May 13, 2026

## What data does Aleph collect?

### Without sign-in (default)
Aleph stores your preferences (theme, fonts, BiDi settings) locally in your browser via `chrome.storage.sync`. Usage insights (time spent, message counts, token estimates per platform) are stored locally via `chrome.storage.local`. **No data is transmitted anywhere.**

### With Google sign-in (optional)
If you choose to sign in with Google, Aleph stores:
- **Email address**: Used solely to identify your account for cross-device sync.
- **Usage insights**: Daily usage summaries (time, messages, tokens per platform) are synced to Google Firebase Firestore so you can access them on other devices.
- **Settings preferences**: Your theme, font, and feature settings are synced to Firestore.

All synced data is stored in a private, user-scoped Firestore document that only you can access (enforced by Firebase security rules).

## What data does Aleph NOT collect?
- Conversation content (your chats are never read or stored)
- Browsing history
- Passwords or credentials
- Payment information
- Data from any website other than claude.ai, chatgpt.com, chat.openai.com, and gemini.google.com

## Third-party services
- **Google Firebase**: Used for optional authentication and data sync. Subject to [Google's Privacy Policy](https://policies.google.com/privacy).
- **Google Fonts**: Loaded only when you select a custom font in settings.

## Data deletion
You can sign out at any time from Settings, which stops all cloud sync. To delete your synced data, sign out and your local data remains intact. Contact offeck100@gmail.com to request full deletion of cloud data.

## Contact
For privacy questions, contact offeck100@gmail.com.
