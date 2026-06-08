# Gemini tab-less tier detection — investigation & future work

**Status:** Not shipped. Part A (DOM detection + persistence) is the current solution.
**Date investigated:** 2026-06-08.

## Problem

Gemini's plan tier (Free / AI Plus / AI Pro / AI Ultra) drives the insights "MONTHLY
SPEND" panel. We want to know a user's tier **without an open Gemini tab** (tab-less), the
way the background already does for Claude (`rate_limit_tier`) and ChatGPT (`planType`).

Today only **Ultra** is detectable tab-less — via the `qpEbW` quota feature id `12`
("Ultra Only"), in `inferGeminiPlanFromQuotas` (`src/background/providerUsage.ts`). **Pro,
Plus, and Free are not distinguishable tab-less.**

## What ships instead (Part A)

`detectGeminiSubscription` (`src/tracker/plans.ts`) reads the account tier badge
`.mavatar-tier-label` ("Pro"/"Ultra"/"Plus") via the pure `geminiPlanFromTierLabel()` and
returns `null` when no authoritative badge is present (so a transient DOM miss never
clobbers a stored plan). Because `saveProviderPlan` never overwrites a known plan with
`null` and the background's Gemini path returns `null` for Pro, **a DOM-detected plan
persists tab-lessly after one visit.** Net behavior: open Gemini once → AI Pro sticks
indefinitely without a tab. This is robust and zero-maintenance; pure never-visit detection
is the only gap.

## Why true tab-less is not feasible today

Investigated every same-origin source the background (host permission: `gemini.google.com`
only) can reach. All are dead ends for the Free↔Pro split:

| Source | Finding |
| --- | --- |
| `qpEbW` quota (background already fetches) | Returns **only** an account-wide credit pool, no tier. Raw: `[[[[], 2, 0, [reset], 48384, 48314]], ""]` → `poolType=2`, `limit=48384`. `parsed[1]` is empty. Per the code comment in `src/tracker/usageGemini.ts`, **free accounts report the same pool**, so the limit does not separate Free from Pro. |
| `/app` HTML + `WIZ_global_data` | Account data is present as flat `boq` field-IDs (stable across builds): `oPEP7c`=email, `qDCSke`/`S06Grb`=gaia id, `FdrFJe`=sid, `SNlM0e`=`at` token. **The tier is an opaque code** — `"Pro"` appears nowhere as a readable value; Google maps code→label in minified JS rebuilt ~daily (`bl=boq_assistant-bard-web-server_<YYYYMMDD>…`). |
| Other page globals | None contain the tier (scanned all globals holding the gaia id — only `WIZ_global_data`). |
| Load batchexecute RPCs (`cZOhpc`, `MaZiqc`, `CNgdBe`, `L5adhe`, `aPya6c`) | Can't be reproduced: empty-`[]` replays return stubs (need real payloads), and bodies can't be captured post-load (the app idles after the load burst; no pre-load injection from devtools/content scripts). |
| `geminiweb-pa.clients6.google.com` | Configured in the page (`GK6dn`/`HUGLxb`) and is the **likely** real tier source — but it's **cross-origin** (background can't call it without a new host permission) and was **not called** on the main `/app` load, so its endpoint/method is unknown. |

**Candidate not validated:** `poolType` (the `2` in the quota row) *might* encode tier, but
confirming requires a Free and an Ultra account sample, which we did not have. Shipping any
limit/poolType heuristic blind would risk misclassifying users — the exact failure the
platform-drift canary exists to catch — so it was not implemented.

## Future-work paths (in order of preference)

1. **Validate the `qpEbW` `poolType` / credit signal (lowest risk).** Capture `qpEbW` from a
   **Free** and an **Ultra** account and compare against Pro's `poolType=2`, `limit=48384`.
   If `poolType` (or clean limit bands) separates tiers, implement it in the *existing*
   background fetch — no new permissions, no fragile decode. Use the repro snippet below.
2. **Reverse-engineer `geminiweb-pa.clients6.google.com`.** Find the membership/tier method,
   add a targeted host permission, parse the (clean) PA JSON. Pro: readable field. Con: new
   host permission (review/privacy), endpoint discovery, possible non-cookie auth.
3. **Decode the opaque `WIZ` tier field.** Find its `boq` field-ID + the code→tier mapping in
   the minified JS. Fragile (mapping changes on rebuilds), needs samples. Not recommended.
4. **`document_start` MAIN-world fetch capture (debug aid).** Temporarily patch `fetch` at
   `document_start` in the tracker to capture which load RPC carries the tier (request +
   response) on a real load, then design a cookie-only background replica. Investigative
   only — not a shipping mechanism by itself.

## Hard requirements for any future implementation

- Must sit behind the **platform-drift canary** (see Part B / `tests/checks.md`
  `platform-contract`) so silent breakage is caught.
- Must **never override a DOM-detected plan** with a lower-confidence background guess —
  respect the no-clobber `null` contract in `detectGeminiSubscription` /
  `sendSubscriptionDetection` / `saveProviderPlan`.
- Must be validated against **Free + Pro + Ultra** before shipping.

## Reproduction snippet (run in the gemini.google.com page console)

Replays the background's exact `qpEbW` call and prints the parsed quota — use it to collect
per-tier samples for path #1:

```js
(async () => {
  const w = window.WIZ_global_data || {};
  const at = w.SNlM0e, sid = w.FdrFJe;
  const bl = 'boq_assistant-bard-web-server_20260607.04_p0'; // update to current build label
  const body = new URLSearchParams();
  body.append('f.req', JSON.stringify([[["qpEbW", "[]", null, "generic"]]]));
  body.append('at', at);
  const url = '/_/BardChatUi/data/batchexecute?rpcids=qpEbW&source-path=%2Fapp'
    + '&f.sid=' + encodeURIComponent(sid) + '&bl=' + encodeURIComponent(bl)
    + '&hl=en&_reqid=' + Math.floor(Math.random() * 1e6) + '&rt=c';
  const raw = await fetch(url, { method: 'POST', body, credentials: 'include' }).then(r => r.text());
  for (const line of raw.split('\n')) {
    try { const a = JSON.parse(line); const d = a[0] && a[0][2]; if (d) return JSON.parse(d); } catch (e) {}
  }
})()
// Pro (this account) returned: [[[[],2,0,[reset],48384,48314]],""]
// Record Free and Ultra outputs here to validate poolType / limit as a tier signal.
```
