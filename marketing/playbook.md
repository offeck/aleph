# Marketing Playbook

The how-to manual. Voice and positioning live in `brand.md`; venues live in
`channels.md`; this file is HOW to choose venues, find leads, and write posts
and replies. The marketing-writer agent treats §d and §e as binding.

## a. How extensions actually grow (distilled, June 2026)

1. **Store conversion beats traffic.** The CWS ranks partly on view→install
   rate — a listing that converts poorly buries itself. Fix the listing before
   driving any traffic (gates in `plan.md`).
2. **Review velocity is the #1 controllable rank lever.** Count and recency of
   ratings move search position more than anything except title keywords.
   Every post ends with at most ONE soft ask; an in-product review prompt is
   the long-term lever (product backlog).
3. **Title keywords decide which searches you can even appear in** — see
   `seo.md`. Everything else tunes position within them.
4. **Update cadence is a ranking signal** — frequent small releases (which this
   repo does anyway) read as "maintained" to both the algorithm and users
   comparing against abandoned competitors.
5. **One channel done well beats five done thin.** A post you return to every
   few hours (answering comments) outperforms three drive-by posts. Comments
   compound: every reply bumps the thread.
6. **Niche pain beats broad appeal at this scale.** "Fixes YOUR broken Hebrew"
   converts; "makes AI chats better" doesn't. Lead with the sharpest pain the
   venue's audience has.
7. **Attribution is per-post installs-delta** (48h window in `channels.md`
   Outcome) — CWS gives no referrers; date alignment is the only signal.

## b. Venue map & selection criteria

**Is a venue worth it?** Score pain-match over size: a 2K-member group of
Hebrew-speaking devs beats a 2M general sub. Check before posting: (1) does the
audience have the exact pain, (2) are self-promo posts allowed (read the rules
THAT DAY — they change), (3) is there a recent precedent post that did well,
(4) can you attach an image.

| Channel type | Norms | Best time | Image | Notes |
|---|---|---|---|---|
| HE/AR Facebook groups | casual, first-person, ≤120 words | Sun–Thu evening IL | yes — hero | admins delete link-first posts; pain-first |
| Platform subreddits | technical-honest, ≤180 words, flair check | Tue–Thu morning US | yes | some require comment karma / ratio |
| Vendor forums (OpenAI community) | reply-only, answer the thread, ≤100 words | any | usually | never top-level self-promo |
| GitHub issue threads | precise, web-side framing only, ≤80 words | any | yes | max 1 comment per issue, 2 issues total |
| Show HN | technical depth, builder story | Tue–Thu 8-10am ET | n/a (link) | runbook §f |
| Product Hunt | polished assets, maker story | Tue–Thu 12:01am PT | gallery | runbook §f |
| dev.to / blog | long-form evergreen, code snippets | any | yes | feeds HN/newsletters; SEO compounding |
| X/Twitter | thread, image in tweet 1, ≤4 tweets | weekday morning | yes | HE version separately |
| WhatsApp/Degree groups | friend voice, zero marketing tone | any | optional | §1c only — never the formal copy |
| Discord servers | ask-the-mods first; many ban promo | any | varies | a deleted post burns the server forever |
| Media pitches (Geektime etc.) | 3-sentence email: angle, proof, link | Sun–Mon | press kit | angle: local dev, open source, real pain |

## c. Finding leads (the scout process — `/marketing scout` automates 1–3)

1. **Run the saved searches** (bottom of `channels.md`) on Reddit, X, and
   Google weekly. New complaint thread = a lead.
2. **Sweep vendor forums** for new RTL/Hebrew/Arabic threads (OpenAI community
   search "RTL" sorted by newest; anthropics/claude-code issues mentioning RTL).
3. **Qualify before adding**: real current pain? thread still active (<3 months
   or evergreen)? does Aleph actually fix it (web pages only — reject
   Claude-Code/Desktop/IDE-only complaints)? If yes → add a `channels.md` row
   with copy-ref and `todo`.
4. **Respond within 24h of finding a live lead** — complaint threads decay
   fast; the asker's accept-an-answer window is short.
5. **Every answered lead gets a follow-up row** — check back in 48h for
   replies/questions; an unanswered follow-up question reads as hit-and-run.

## d. Post anatomy (binding for marketing-writer)

1. **Hook = their pain, first line.** The product name does not appear before
   line 2. Describe the symptom the way the audience experiences it ("periods
   jump to the start of lines"), not the technology ("BiDi algorithm fails").
2. **Body: max 3 bullets/claims, specifics over adjectives.** "Detects
   direction per paragraph from the actual characters" — never "smart",
   "powerful", "seamless".
3. **Proof: attach the before/after image wherever images are allowed.** It
   carries more weight than any sentence.
4. **Close: links + at most one soft ask.** Store link, repo link ("completely
   open source"), free + no data collection. One closing line like "אם זה עוזר —
   דירוג בחנות יעזור לי" / "a store rating helps a lot". Never two asks.
5. **Length caps**: FB/Telegram ≤120 words · Reddit top-level ≤180 · HN body
   ≤300 · forum/issue reply ≤100 · X thread ≤4 tweets.
6. **Language = the venue's language.** HE venues get the HE copy, never
   translated-English tone (brand.md voice notes per language).

## e. Answer/reply guidelines (binding for marketing-writer)

1. **Mirror the asker's exact symptom in your first sentence** — proves you
   read their post, not pattern-matched it.
2. **Answer the question even where Aleph isn't the whole answer** (e.g.,
   explain WHY BiDi breaks). Value first, product second.
3. **Disclosure is mandatory**: "(Disclosure: I'm the author.)" — every
   external reply, no exceptions.
4. **One link block per reply, one reply per thread.** Never comment twice in
   the same thread unless someone replies to you.
5. **Skeptics get edge-case offers, not arguments**: "if you hit a case it
   doesn't handle, send it and I'll fix it" — then actually fix it (it becomes
   a "fix of the week" post).
6. **Competitor threads**: never reply to a competitor's announcement/support
   thread with promotion. If someone asks for a comparison elsewhere, be
   factually generous to them (brand.md Never-list).
7. **Claude-Code/Desktop threads**: open with "this bites on claude.ai web
   too — for the web side, meanwhile, …". Never imply the extension fixes
   non-web surfaces.

## f. Launch-day runbooks

**Show HN** — Tue–Thu, 8–10am ET. Title from launch-posts §3. Have ready
before posting: the technical first comment (BiDi depth), answers to the
predictable questions (permissions? why not userscript? Firefox? — "Chrome
first; MV3 port to Firefox is tracked in issues"). Stay in the thread all day;
answer every technical question; never argue. If it doesn't front-page, it
still seeds Google results — don't repost for at least a month.

**Product Hunt** — Tue–Thu, 12:01am PT. Assets: gallery = the 4 store
screenshots + GIF; tagline from launch-posts §6; maker comment = personal
story (unreadable Hebrew calculus chats). Line up 3–5 friends to genuinely try
it and comment with real impressions that day — no vote rings (PH detects and
buries). Reply to every comment.

## g. Review-velocity tactics

- Per-post: the single closing ask (§d.4) — that's it.
- Friends round (Gate 2): personal ask, "only if you actually use it, and be
  honest" — 5–8 people, one time.
- Product lever (backlog item, not now): a gentle in-popup "enjoying Aleph?"
  prompt after ~7 active days, dismissible forever. Standard practice, biggest
  long-term lever; build after the listing overhaul proves conversion.
- Never: incentives, swaps, review-for-review, asking to "rate 5 stars" (ask
  for a rating, not a number).
