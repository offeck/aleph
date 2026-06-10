---
name: marketing
description: Marketing operations console for Aleph. Reviews trackers and proposes weekly actions (plan), drafts venue-adapted post copy via the marketing-writer agent and — with explicit per-post confirmation — posts/replies on automatable venues (post), appends weekly CWS metrics (log), audits the store listing for CWS SEO/policy compliance via the seo-auditor agent (audit), and hunts new venues/complaint threads (scout). Use for any marketing, store-listing, posting, metrics, or lead-finding task.
argument-hint: "[plan | post <venue> | log <k=v ...> | audit | scout [topic]]"
---

# Marketing Ops Workflow

**GLOBAL RULES — read before doing anything:**
1. **Posting is confirmation-gated, always.** You may reply/post/comment on the user's behalf ONLY after: (a) presenting the EXACT final copy and the EXACT target (venue + URL), and (b) receiving a fresh, explicit confirmation for THAT specific post in this conversation. One confirmation = one post — never batch several posts under one approval, never reuse an earlier approval, never treat the skill invocation itself as approval. If anything about the copy or target changes after approval, re-confirm.
2. **Respect platform capability honestly.** Some venues are automatable (GitHub via `gh`, some forums via browser tools); others are blocked for automation (Reddit, Facebook, X, WhatsApp — the browser layer refuses them) or too account-sensitive to automate (HN, Product Hunt). Check the venue's Auto-post value in `marketing/playbook.md` §b. For non-automatable venues, deliver paste-ready copy and say plainly that the human posts it — never claim you posted.
3. **After any post you make: verify it is live, capture the live URL, and update `marketing/channels.md` in the same turn.** A post that isn't logged doesn't exist.
4. File writes are limited to `marketing/*.md`. Never touch `src/`, `manifest.json`, or anything else.
5. Copy drafting MUST go through the `marketing-writer` agent; listing audits MUST go through the `seo-auditor` agent. Do not do their work inline.
6. Before acting in any mode, read `marketing/plan.md` (the Gates section governs everything) and `marketing/README.md` (hard rules).

---

Parse the mode from `$ARGUMENTS`:
- First token = mode: `plan` (default when empty), `post`, `log`, `audit`, `scout`.
- Everything after the first token = mode arguments.
- Unknown first token → show the five modes with one-line descriptions and ask which to run.

---

## Mode: plan (default)

1. Read `marketing/plan.md`, `marketing/metrics.md` (last 2 weekly rows + experiments due for review), `marketing/channels.md` (all `todo` and `follow-up` rows), and the last row of `marketing/seo.md`'s audit log.
2. **Check the gates.** If either gate is unmet, the proposal may contain ONLY gate-clearing actions (listing session, review seeding) — no posting actions.
3. Propose ≤5 actions for this week, each as `action — why — done-when`. Consider: the next channel per the stagger rule (one every 2-3 days), a metrics row if >7 days since the last, an audit if >30 days since the last, `follow-up` rows past their date, stale Notes-inbox items to promote or delete.
4. Present the proposal. On user approval: rewrite the "Now" section of `marketing/plan.md` (move completed items out, keep max 5), and prune approved-stale inbox notes.

## Mode: post <venue>

1. Find the venue's row in `marketing/channels.md` (fuzzy-match on the Venue column). If absent, propose a new row (venue, type, URL, lang, copy ref per `playbook.md` §b) and add it on approval.
2. **Gate check** (plan.md): if gates are unmet, warn explicitly and require the user to say "override" before continuing.
3. Spawn the writer — do not draft inline:

```
Agent({
  subagent_type: "marketing-writer",
  description: "Draft copy for {venue}",
  prompt: "Venue: {venue}\nVenue type: {type from channels.md}\nLanguage: {lang}\nBase variant: marketing/launch-posts.md §{copy ref}\nThread URL: {URL if the row is a live thread, else omit}\nVenue notes: {Notes column}\nExtra context: {anything the user added}\n\nProduce ready-to-paste copy per your output format. For a top-level post produce two labeled variants (A/B); for a thread reply produce one."
})
```

4. Present the copy (both variants if applicable) + the pre-post checklist + the exact target URL. Remind: attach the hero image where allowed (`store-assets/final/01-before-after.png` — image upload is usually a manual step even on automatable venues).
5. **Determine the posting path** from playbook §b Auto-post:
   - **`gh` (GitHub issues/discussions):** on explicit confirmation of the final text, post with `gh issue comment <url> --body-file <tempfile>` (write the body to a temp file first — never inline-quote it through the shell). Verify with `gh issue view --comments | tail`, capture the comment URL.
   - **`browser` (Discourse forums and other allowed sites):** on explicit confirmation, use the claude-in-chrome tools on the user's logged-in session: navigate to the thread, click reply, paste the text, screenshot the filled editor, **re-confirm with the user against the screenshot**, then submit. Verify the comment renders, capture its URL. If the browser layer refuses the site or the flow breaks twice, stop and fall back to manual paste — do not keep retrying.
   - **`manual` (Reddit, Facebook, X, WhatsApp, HN, Product Hunt, LinkedIn, Discord):** deliver the copy and wait for the human to post; ask for the live URL afterwards.
6. **Log in the same turn**: update the row — Status=`posted`/`replied`, Posted={date}, Outcome={live URL}. Add a follow-up row (or note) dated +48h: "log installs delta + answer replies". If the user declined to post, leave Status as `todo` and note the decision.

## Mode: log <k=v ...>

1. Parse pairs: `users= installs= uninstalls= impressions= rating= ratings= stars= note=`. All optional.
2. For missing values, ask the user (link them to https://chrome.google.com/webstore/devconsole → item → Stats). If a CWS dashboard tab is already open and the user consents, browser tools may be used to READ the numbers from it — read-only, never click.
3. Append the row to the Weekly log table in `marketing/metrics.md` (today's date).
4. Report deltas vs. the previous row. Flag: impressions↑ with installs flat (CTR problem — point at listing), uninstalls >30% of installs (expectation mismatch — read recent reviews), any experiment whose "Review on" date has passed (prompt for Result/Verdict).

## Mode: audit

1. Spawn the auditor — do not count inline:

```
Agent({
  subagent_type: "seo-auditor",
  description: "Audit store listing vs CWS policy",
  prompt: "Audit marketing/store-listing.md (EN, iw, ar) against the policy rules and marketing/seo.md keyword strategy. Include the competitor web-check. Produce the full report per your output format."
})
```

2. Append the agent's audit-log row to the Audit log table in `marketing/seo.md` (fill "Actions taken" after step 3).
3. Present the recommended edits as numbered before→after diffs. Apply ONLY the ones the user approves, to `marketing/store-listing.md`. Update the audit-log row's "Actions taken".
4. Remind: repo edits don't change the live store — the human must re-paste into the dashboard, and listing-text changes trigger CWS re-review (bundle changes; record an experiment row in `metrics.md`).

## Mode: scout [topic]

1. Read the saved-searches list at the bottom of `marketing/channels.md`. If a `[topic]` argument was given, search that instead/additionally.
2. Load `WebSearch` (and `WebFetch`) via ToolSearch if not loaded. Run the searches (Reddit, X, vendor forums, GitHub issues).
3. Qualify each promising hit per `playbook.md` §c.3: real current pain · thread active (<3 months old or evergreen) · Aleph actually fixes it (web pages only — REJECT Claude-Code/Desktop/IDE-only complaints) · venue allows replies/posts.
4. Dedupe against every URL already in `marketing/channels.md`.
5. Present qualified finds as proposed table rows (venue, type, URL, lang, recommended copy ref, Auto-post path, notes incl. why qualified). Append ONLY user-approved rows to the right section of `channels.md`.
6. Scout never posts — answering a found lead is `post` mode, with its own confirmation.

---

## Example invocations

- `/marketing` — weekly planning pass
- `/marketing post r/ClaudeAI` — draft the r/ClaudeAI top-level post (manual venue: human pastes)
- `/marketing post OpenAI forum KaTeX` — draft + (after confirmation) post the reply via browser
- `/marketing post claude-code 38005` — draft + (after confirmation) comment via gh
- `/marketing log users=12 installs=9 rating=4.5 ratings=6 note="HE FB post day"`
- `/marketing audit` — monthly listing/policy audit
- `/marketing scout` — sweep saved searches for new complaint threads

## Summary

Always end by reporting: what was posted where (with live URLs) vs. what awaits manual posting, what changed in which `marketing/*.md` files, and the next due item from `plan.md`.
