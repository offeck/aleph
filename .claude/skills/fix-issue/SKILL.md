---
name: fix-issue
description: End-to-end bug fix workflow for the Aleph Chrome extension. Reproduces the issue visually in Chrome, investigates root cause via a dedicated agent, plans a general fix via a second agent, implements the fix, reloads the extension, verifies visually, and runs regression tests against all known sessions.
argument-hint: <url> <description> [image-path]
---

# Fix Issue Workflow

Parse the following from `$ARGUMENTS`:
- **url** (required): Chat session URL where the bug is visible
- **description** (required): What's wrong — the visual bug or rendering issue
- **image** (optional): Path to a screenshot showing the problem

If url or description is missing, ask the user before proceeding.

Determine the **platform** from the URL:
- `claude.ai` → `claude`
- `chatgpt.com` or `chat.openai.com` → `chatgpt`
- `gemini.google.com` → `gemini`

---

## Step 1: Reproduce the Problem

Load the browser tools via `ToolSearch`:
```
select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__javascript_tool,mcp__claude-in-chrome__read_console_messages
```

Then:
1. Get current tab context via `tabs_context_mcp`
2. Create a new tab or navigate to the session URL
3. Wait ~5 seconds for the page and extension to initialize (`patchAll` runs at 0ms, 1.5s, then every 3s)
4. Use `read_page` to visually inspect the page
5. If the user provided a `precedingMessage`, use `javascript_tool` to search for it on the page and scroll to that section
6. If an image was provided, read it with the `Read` tool and compare against the page state

**Confirm reproduction:** Note exactly what you see — which elements are wrong, expected vs. actual rendering. Use `javascript_tool` to inspect specific elements (computed styles, attributes, text content, DOM structure).

If the bug **cannot be reproduced**, report this to the user and ask how to proceed.

If the bug **is confirmed**, collect:
- Affected DOM elements (tag names, classes, attributes, computed styles)
- The category: `bidi-text`, `bidi-math`, `latex-rendering`, `theme`, `streaming`, `focus-mode`, `selector-breakage`, or `general`
- Any console errors from `read_console_messages` with pattern `Aleph|aleph`

**Before snapshot** — Capture a structured reference for the broken elements so you can compare after the fix:
- The CSS selectors or XPaths that identify each broken element
- Their current computed styles (`direction`, `unicode-bidi`, `display`, `content`, etc.)
- Their current text content and how it visually renders (order of characters, misplaced symbols)
- Any relevant DOM attributes (`data-aleph-rtl`, `data-aleph-theme`, etc.)

Keep this snapshot — you will diff it against the post-fix state in Step 5.

---

## Step 2: Investigate Root Cause

Spawn the `issue-investigator` agent using the Agent tool:

```
Agent({
  subagent_type: "issue-investigator",
  description: "Investigate root cause of {category} bug",
  prompt: "Investigate this Aleph extension bug:\n\n- Platform: {platform}\n- Category: {category}\n- Bug: {description}\n- Visual observation: {what you observed in the browser}\n- Affected elements: {DOM details — tags, classes, attributes, computed styles}\n- Console errors: {any errors found}\n\nRead the source code (content.js, content.css), find the root cause, generalize the problem, and report all locations where this class of bug could occur."
})
```

Wait for the investigation results. Read and understand the findings before proceeding.

---

## Step 3: Plan the Fix

Spawn the `issue-planner` agent using the Agent tool:

```
Agent({
  subagent_type: "issue-planner",
  description: "Plan general fix for {category} bug",
  prompt: "Plan a fix for this Aleph extension bug:\n\n- Platform: {platform}\n- Category: {category}\n- Bug: {description}\n- Visual observation: {what was observed}\n\n## Investigation Findings\n{paste the full investigation agent output here}\n\nDesign a general solution that fixes ALL instances of this bug class. No monkey patches. Research how competing tools handle this. Produce a step-by-step implementation plan with specific file and line changes."
})
```

Wait for the plan. Review it critically:
- Does it address the root cause or just the symptom?
- Is it truly general, or does it only fix the reported instance?
- Are the changes surgical and consistent with existing patterns?

---

## Step 4: Implement the Fix

Follow the plan from Step 3. Rules:
1. Read each file before editing
2. Follow existing code patterns — check `SELECTORS[platform]`, `THEMES`, `patchAll()`, `applyStyles()`, `hasHebrew()` before adding new abstractions
3. Make surgical changes only — every changed line must trace to the fix
4. Verify the fix is general: will it handle ALL instances, not just the one reported?
5. After implementing, re-read modified files to check for syntax errors

---

## Step 5: Reload Extension & Verify

Reload the extension via `background.js`. The manifest has `externally_connectable` configured for all supported platforms, so web pages can message the extension directly. Use `javascript_tool` to run:

```javascript
(() => {
  const link = [...document.querySelectorAll('link[href^="chrome-extension://"]')]
    .find(l => l.href.includes('content.css'));
  if (!link) return 'FAIL: Cannot find extension ID — ask user to reload manually';
  const extId = link.href.match(/chrome-extension:\/\/([^/]+)/)?.[1];
  if (!extId) return 'FAIL: Cannot parse extension ID';
  chrome.runtime.sendMessage(extId, {type: 'aleph-reload'});
  return 'OK: Reload triggered for ' + extId;
})()
```

If this returns FAIL, ask the user to reload manually (chrome://extensions → Aleph → reload button).

After reload:
1. Navigate back to the original session URL
2. Wait ~5 seconds for extension initialization
3. Use `read_page` to verify the bug is fixed
4. Use `javascript_tool` to inspect the same elements from Step 1. Compare against the **before snapshot**: verify the broken styles, attributes, and rendering are now correct
5. Check for console errors via `read_console_messages` with pattern `Aleph|aleph|error`

**If the fix works:** Proceed to Step 6.

**If the fix does NOT work:** Report what you observe. Return to Step 2 with new observations. Include what changed and what's still broken.

---

## Step 6: Regression Testing

Read `tests/sessions.json`. Collect all entries with `"status": "active"`.

For each active entry, grouped by platform:

1. Navigate to the session URL
2. Wait ~5 seconds for page load + extension init
3. Verify the page loaded (not redirected to login/error)
4. Run each check from the entry's `checks` array via `javascript_tool`:

### Check Implementations

Run each check using the JavaScript snippets in [checks.md](checks.md). Each returns `PASS:`, `FAIL:`, or `SKIP:` with details. For `no-console-errors`, use `read_console_messages` instead of `javascript_tool`.

5. Read console messages for Aleph errors
6. Record pass/fail per check per session

### Regression Report

After testing all active sessions:

- **ALL pass**: Report success. Proceed to update `tests/sessions.json`.
- **ANY fail**: Report which sessions and checks failed. For each failure:
  1. Determine if it's caused by your fix (a regression) or a pre-existing issue
  2. If it's a regression: go back to **Step 1**, treating the regression as the new bug. The original URL and the regressed URL are both targets.
  3. If it's pre-existing and unrelated to your fix: note it in the report but proceed

---

## Step 7: Update Session Registry

After successful fix + regression sweep:

1. Read `tests/sessions.json`
2. If this bug matches an existing entry: update `status` to `"fixed"`
3. If this is a new bug, add an entry:
   ```json
   {
     "id": "{platform}-{category}-{NNN}",
     "platform": "{platform}",
     "url": "{session_url}",
     "description": "{concise description of what was broken and how it was fixed}",
     "category": "{category}",
     "precedingMessage": "{the message text used to find the section, if any}",
     "checks": ["{relevant check IDs}"],
     "source": "conversation:{today's date YYYY-MM-DD}",
     "addedAt": "{today's date YYYY-MM-DD}",
     "status": "fixed"
   }
   ```
4. Write the updated file

---

## Summary

Report to the user:
- What the bug was
- Root cause (one sentence)
- What was changed (files and nature of change)
- Verification result (visual + regression)
- Any known limitations or edge cases
