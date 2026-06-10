# CWS SEO Strategy

## How ranking works (verified June 2026 — constraints, do not violate)

- **Title** is the heaviest keyword surface. ~35 chars visible in search
  results; ≤45 best practice (75 hard limit); front-load keywords.
- **Summary** (132 max) is the search snippet → CTR → conversion is itself a
  ranking signal.
- **Keyword-spam policy**: every keyword <5 instances per description; **≤5
  brand/website names**; must read naturally. Violations risk takedown.
- Each locale listing (we run EN + iw + ar) indexes that locale's searches.
- Other signals: rating count/average + velocity, install velocity,
  view→install conversion, update frequency, MV3 compliance ✓.
- Future: "verified developer domain" badge boosts rank — requires owning a
  domain. Parked in plan.md notes.

## Keyword strategy

### English

| Tier | Keyword | Where | Rationale |
|---|---|---|---|
| P | RTL | title, summary, desc | what bilingual devs actually type |
| P | Hebrew / Arabic | title, summary, desc | language-name searches |
| P | Claude / ChatGPT / Gemini | summary, desc ≤3× each | brand-qualified intent ("claude rtl") |
| P | right-to-left | desc 1× | spelled-out variant |
| S | insights / usage / rate limit / quota / token | title (insights), desc | the meters wedge — Gaugr's keyword space |
| S | dark theme | desc themes bullet | top generic CWS search term |
| S | BiDi, Persian (Farsi), Urdu | desc 1× each | niche, zero competition |

### עברית (iw)

| Tier | Keywords |
|---|---|
| P | עברית, עברית הפוכה, טקסט הפוך, כיוון טקסט, יישור לימין |
| S | תיקון עברית, RTL, ערכות נושא, מעקב שימוש |

### العربية (ar)

| Tier | Keywords |
|---|---|
| P | العربية, نص مقلوب, اتجاه النص, من اليمين إلى اليسار, إصلاح العربية |
| S | RTL, سمات, تتبع الاستخدام |

## Title & summary — current decision (2026-06-10)

- **Title**: `Aleph: Hebrew/Arabic RTL Fix + Insights Dashboard` (49 chars —
  past the 45 best-practice, under the 75 hard limit; the visible ~35-char
  window "Aleph: Hebrew/Arabic RTL Fix + Ins…" carries the load-bearing
  keywords; full title shows on the listing page).
- **Summary (EN)**: `Fix broken Hebrew & Arabic RTL text in Claude, ChatGPT &
  Gemini — themes, focus mode, and a cross-platform AI usage dashboard.` (126).
- HE/AR titles unchanged (already keyword-front-loaded).

## Brand-mention budget (the ≤5 rule)

The de-branded description keeps only functionally-necessary names: the three
platforms (+Codex/Antigravity once, in the meters bullet), Google Fonts (the
actual font source), KaTeX/MathJax (what gets isolated), and the single repo
link. Theme names, font names, and the bare domain list were removed
2026-06-10. **Residual risk**: still >5 distinct names under the most literal
policy reading — unavoidable for a multi-platform extension; enforcement
targets discretionary stuffing, which is what was removed. Fallback if CWS
ever flags it: name the platforms exactly once and cut Codex/MathJax/Antigravity.

## Audit log (appended by `/marketing audit`)

| Date | Auditor | Result | Violations | Actions taken |
|---|---|---|---|---|
| 2026-06-10 | manual (plan session) | FAIL → fixed | ~22 distinct brand names in EN desc (9 themes, 5 fonts, 3 domains) | de-brand edits applied to all 3 locales; title/summary updated |
