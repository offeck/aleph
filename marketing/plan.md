# Plan

## Gates (standing — check before ANY posting)

- [ ] **Gate 1 — listing live.** The dashboard shows the new screenshots + copy
  (after the pending CWS review clears; re-run the failed publish job for
  v2.8.1, then do the full dashboard session in one go). Traffic to the old
  listing (one watermarked screenshot, 3.0★) converts badly and first
  impressions don't repeat.
- [ ] **Gate 2 — seed honest reviews.** ≥5 reviews, ≥4.5★ average, from real
  users (friends/classmates who actually use it) — honestly, unincentivized.
  Social proof must exist before traffic lands.
- After gates: stagger one channel every 2–3 days; reply to every comment the
  same day; watch installs-per-day per post in `metrics.md` + `channels.md`.

## Now (this week, max 5)

- [ ] Check CWS review status for v2.8.0/2.8.1; when clear, do the single
  dashboard session: screenshots, EN/HE/AR copy, new title, category →
  Accessibility — done-when: listing shows all of it live
- [ ] Ask 5–8 friends who use AI chats in Hebrew to install + honestly rate —
  done-when: Gate 2 numbers reached
- [ ] First real `metrics.md` row after the listing goes live (baseline row
  exists) — done-when: row appended with dashboard numbers
- [ ] Record the before/after GIF (3–4s toggle loop) — done-when: file in
  store-assets/, linked from launch-posts asset backlog

## This month

- w/o Jun 15 — gates cleared, HE Facebook round (3 groups) + complaint-thread replies
- w/o Jun 22 — Reddit round (r/ClaudeAI top-level + r/Egypt_Developers AR post)
- w/o Jun 29 — Show HN (weekday morning US) if listing metrics look healthy

## Notes inbox (append anywhere, newest first; promote to Now or delete weekly)

- 2026-06-10 — ai-toolbox.co ranks for "chatgpt rtl fix" with a content article;
  our own ranking article (GitHub Pages) is the counter — in playbook backlog.
- 2026-06-10 — verified-developer-domain badge boosts store rank; needs a real
  domain. Park until there's traction worth the spend.

## Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-06-10 | Store title → "Aleph: Hebrew/Arabic RTL Fix + Insights Dashboard" (49 chars) | Both wedges + both language keywords; user preference for "Insights Dashboard" (product's own term); visible search window carries RTL/Hebrew/Arabic |
| 2026-06-10 | Mini-game gets description bullet + post + screenshot candidate, not title space | Zero search volume; high meme value belongs in content, not the 45-char keyword surface |
| 2026-06-10 | Emulator/rules tests not in publish.yml; rules ship via deploy:rules | Release path must not flake on an artifact that isn't in the CWS zip |
