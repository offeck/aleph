---
name: marketing
description: Marketing operations console for Aleph. Reviews trackers and proposes weekly actions (plan), drafts venue-adapted post copy via the marketing-writer agent (post), appends weekly CWS metrics (log), audits the store listing for CWS SEO/policy compliance via the seo-auditor agent (audit), and hunts new venues/complaint threads (scout). Use for any marketing, store-listing, posting, metrics, or lead-finding task.
argument-hint: "[plan | post <venue> | log <k=v ...> | audit | scout [topic]]"
---

# Marketing Ops Workflow

**GLOBAL RULES — read before doing anything:**
1. **NEVER post, comment, rate, publish, or submit anything anywhere** — not on Reddit, forums, Facebook, GitHub, the CWS dashboard, or any other site, and not even if browser tools are connected. You produce copy and tracker updates; the human pastes. No exceptions, no "just this once".
2. File writes are limited to `marketing/*.md`. Never touch `src/`, `manifest.json`, or anything else.
3. Copy drafting MUST go through the `marketing-writer` agent; listing audits MUST go through the `seo-auditor` agent. Do not do their work inline.
4. Before acting in any mode, read `marketing/plan.md` (the Gates section governs everything) and `marketing/README.md` (hard rules).

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
  prompt: "Venue: {venue}\nVenue type: {type from channels.md}\nLanguage: {lang}\nBase variant: marketing/launch-posts.md §{copy ref}\nThread URL: {URL if the row is a live thread, else omit}\nVenue notes: {Notes column}\nExtra context: {anything the user added}\n\nProduce ready-to-paste copy per your output format."
})
```

4. Present the agent's copy + pre-post checklist verbatim. Remind: attach the hero image where allowed (`store-assets/final/01-before-after.png`).
5. The human posts manually. After they confirm, update the row: Status=`posted` (or `replied`), Posted={date}, Outcome={live post URL}. Add a follow-up row (or note) dated +48h: "log installs delta + answer replies".

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
5. Present qualified finds as proposed table rows (venue, type, URL, lang, recommended copy ref, notes incl. why qualified). Append ONLY user-approved rows to the right section of `channels.md`.
6. Never reply to anything found — that's `post` mode, after approval, by the human.

---

## Example invocations

- `/marketing` — weekly planning pass
- `/marketing post r/ClaudeAI` — draft the r/ClaudeAI top-level post
- `/marketing post OpenAI forum KaTeX` — draft the reply for the KaTeX-RTL thread
- `/marketing log users=12 installs=9 rating=4.5 ratings=6 note="HE FB post day"`
- `/marketing audit` — monthly listing/policy audit
- `/marketing scout` — sweep saved searches for new complaint threads
- `/marketing scout perplexity rtl` — scout a specific topic

## Summary

Always end by reporting: what changed in which `marketing/*.md` files, what the human must do manually (paste/post/dashboard), and the next due item from `plan.md`.
