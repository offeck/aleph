# Aleph TypeScript Migration Plan

> **Status: in progress.** Live execution plan for converting Aleph from 9 flat IIFE JS files to TypeScript modules bundled with esbuild. Work proceeds **one phase = one commit + verification**. Tick checkboxes as you go and commit this file with each phase. **Delete this file in the final phase**, when the branch is ready and PR #2 merges.

## 0. Why / Constraints / Rules

**Goal.** Replace 9 hand-written IIFE files (`content.js`, `insights-tracker.js`, `mini-game.js`, `background.js`, `popup.js`, `settings.js`, `insights.js`, `sync.js`) with TypeScript under `src/`, compiled by a small `build.mjs` esbuild script into `dist/<entry>.js` — one bundle per current entry. Kill duplicated constants/helpers into `src/shared/`. Add type safety, vitest unit tests, and CI — without changing runtime behavior or breaking the published extension.

**Extension identity (shapes everything).** The unpacked extension loads from the repo root; the extension ID derives from that path. Moving `manifest.json` would change the ID and orphan all `chrome.storage` (settings + insights history). Therefore:

- `manifest.json` + `popup.html` / `settings.html` / `insights.html` stay at repo root — the root remains the unpacked-extension directory
- esbuild outputs to `dist/`; manifest js paths and HTML `<script src>` point into `dist/`
- `dist/` is gitignored; the publish workflow builds before zipping
- the zip ships `manifest.json`, HTML, CSS, `icons/`, `vendor/`, `dist/` — never `src/`
- `vendor/` (katex + firebase compat SDKs + `firebase-config.js`) stays as-is

**Rules (every phase):**

1. Behavior-identical moves only; no "while I'm here" improvements.
2. Cleanups are separate commits (the settings.js divergence fix rides Phase 2, explicitly called out).
3. Never rename storage keys (`usage_YYYY-MM-DD`, `insights_*`, `aleph_sync_*`) or message `type` strings — frozen wire contract.
4. Metric-key strings (`chatgpt:model:<id>`, `chatgpt:limit:<id>`, `chatgpt:codex.credits`, `chatgpt:codex.workspace.*`, `gemini:credits`, `gemini:feature:<id>`) are frozen; one shared builder, fixture-locked.
5. `VERSION` must equal manifest `version` (2.7.7) — moves to `src/shared/version.ts`; no version bump during migration.
6. `tests/checks.md` snippet copies of the RTL regex / selector unions stay literal (console snippets can't import); only their KEEP IN SYNC comments get repointed to `src/shared/rtl.ts` / `src/shared/selectors.ts`.
7. `data-aleph-ext-id` must be set early by the content bundle on every phase (dev reload + regression agent depend on it).
8. Firebase init order is load-bearing: the four `importScripts` (app/auth/firestore compat + config) run before any code touching `firebase`/`ALEPH_FIREBASE_CONFIG`; the repo ships a **real** apiKey so the `!== "PLACEHOLDER"` guard genuinely fires — test it.
9. TypeScript debt is budgeted until Phase 6: count `tsc --noEmit --pretty false` diagnostics by `error TS`, fail CI if the count grows, and update the committed baseline only when the count shrinks in the same phase commit.
10. Tests are part of every behavioral change: add or update automated coverage for changed logic when practical; when browser-only/manual verification is the only realistic path, record the reason and the manual check. From Phase 2 onward `npm test` must discover real tests.
11. CSS rule order is behavior: splits preserve original rule order (never alphabetize); shared extractions may only contain byte-identical blocks — intentionally divergent rules (e.g. settings' darker selects) stay per-page.

**Definition of done (per phase):** code committed; `npm run build` green; Phase 1 records raw `npm run typecheck`, Phases 2–5 require `npm run typecheck:baseline`, and Phase 6 requires raw `npm run typecheck`; `npm test` green with relevant tests added/updated for changed behavior; extension reloads via `aleph-reload` with no new console errors; the phase's spot-checks pass; checkboxes ticked in the same commit.

## Target layout (end state)

```
repo root/
  manifest.json                      (stays at root forever — identity constraint;
                                      popup/css paths point into dist/)
  icons/  vendor/                    (stay at root: the repo root IS the package
                                      root; /vendor/* paths are load-bearing)
  build.mjs  package.json  tsconfig.json  vitest.config.ts  eslint.config.mjs
  dist/                              (gitignored: JS bundles + bundled CSS + copied HTML)
  src/
    shared/     version.ts platform.ts defaults.ts themes.ts pricing.ts
                platformMeta.ts dates.ts format.ts rtl.ts metricKeys.ts
                selectors.ts messages.ts ui.css (exact-duplicate page-chrome blocks)
    content/    index.ts settingsStore.ts selectors.ts fonts.ts theme.ts
                bidi.ts focus.ts streaming.ts latex.ts styles.ts badge.ts
                content.css (Phase 4 splits into styles/{bidi,streaming,focus,
                theme-transitions,platform-fixes}.css imported in ORIGINAL ORDER)
    tracker/    index.ts send.ts tokens.ts time.ts messages.ts timing.ts
                plans.ts usageClaude.ts usageChatgpt.ts usageGemini.ts modelCaps.ts
    background/ index.ts usage.ts metrics.ts remarks.ts cleanup.ts router.ts sync.ts
    popup/      index.ts meters.ts insightsView.ts ui.ts popup.html popup.css
    settings/   index.ts settings.html settings.css
    insights/   index.ts insights.html insights.css
    mini-game/  index.ts
  tests/
    checks.md  sessions.json    (stay; KEEP-IN-SYNC comments repointed)
    unit/      plans.spec.ts codex.spec.ts gemini.spec.ts metrics.spec.ts
               mergeUsageDay.spec.ts defaults.spec.ts
```

Module boundaries are the plan, not dogma — if a split creates a cycle or awkward live-binding, merge two modules rather than invent indirection.

## Canonical-copy decisions (duplication dies in `src/shared/`)

| Symbol | Copies today | Canonical winner |
|---|---|---|
| `DEFAULTS` | content.js:240, popup.js:5, settings.js:4 | popup/content copy **with `miniGame:false`** (settings copy diverged) |
| `THEME_NAMES` | popup.js:32, settings.js:30 | popup copy **with `none:"Default"`** |
| `THEMES` | content.js:28 | move as-is |
| `PRICING` | insights.js:10, insights-tracker.js:23 | identical — either |
| `PLATFORM_COLORS`/`LABELS` | popup.js:40, insights.js:4 | identical — either |
| `localDateString`/`usageKeyForDate`/`todayKey` | background/popup/insights/tracker | one shared impl |
| `formatTime`/`formatTokens` | popup:52, insights:18 | template-literal form |
| `RTL_SCRIPT_LETTER_RE` (+`_G`) | content.js:7, tracker:15 | shared base + global-flag export |
| platform detection | content:12, tracker:5, mini-game:5 | `detectPlatform(hostname)` |
| metric-key builders | background:112-141 ↔ popup consumers | `src/shared/metricKeys.ts` |

**Only intentional behavior delta (Phase 2):** settings page gains the `miniGame` key in its DEFAULTS round-trip and a "Default" option in per-platform theme dropdowns — both fix pre-existing latent bugs; called out in the commit body.

## Message protocol → `src/shared/messages.ts`

Discriminated union on `type`: content/tracker→bg fire-and-forget (`disabled`, `badge`, `insights-time`, `insights-send-analytics`, `insights-response-timing`, `insights-message`, `insights-subscription`, `insights-model-caps`, `insights-usage`); pages↔bg request/response (`insights-get-summary`, `aleph-sync-status/signin/signout/now`); bg→content (`toggle`); external (`aleph-reload`). Fields exactly as the current router reads them — no additions/removals.

## Build / config artifacts

**`build.mjs`** — esbuild driver, no framework. Entries: `content→src/content/index.ts`, `insights-tracker→src/tracker/index.ts`, `mini-game`, `background`, `popup`, `settings`, `insights`. Options: `bundle, format:"iife", target:["chrome120"], platform:"browser", sourcemap: dev ? "inline" : false, minify: false` (always readable — store-review friendly, size irrelevant). `--watch` uses esbuild contexts. katex NOT bundled (stays a separate vendored content-script entry); firebase NOT bundled (importScripts from inside the background bundle).

**`tsconfig.json`** — ES2022, module ESNext, moduleResolution Bundler, lib ES2022+DOM+DOM.Iterable+WebWorker, types chrome+node, `strict:true`, noUnusedLocals/Parameters, isolatedModules, verbatimModuleSyntax, `noEmit:true` (esbuild emits), transitional `allowJs:true` (removed Phase 6). During Phases 2–5 the gate is build+test green plus no growth in the `tsc` diagnostic baseline. Phase 6 drives it to zero.

**`vitest.config.ts`** — node environment, `tests/unit/**/*.spec.ts`. Phase 1 may temporarily use `passWithNoTests:true`; Phase 2 removes it so empty test suites fail. Pure modules (`metricKeys`, `metrics`, `plans`, codex/gemini normalizers, sync `_mergeUsageDay`) get `export`ed by the splits — behavior-neutral since bundled IIFEs leak no globals.

**`package.json`** — private, type module; scripts: `build` (node build.mjs), `dev` (--dev --watch), `typecheck` (tsc --noEmit), `test` (vitest run), `lint` (eslint .), `check` (typecheck+lint+test+build once Phase 6 is strict). Phase 2 adds `typecheck:baseline` (runs `scripts/check-typecheck-baseline.mjs`). devDeps: esbuild, typescript, vitest, @types/chrome, @types/node, eslint, typescript-eslint. Commit `package-lock.json`.

**`.gitignore`** — add `dist/`.

**`manifest.json`** — content_scripts js: `["vendor/katex/katex.min.js", "dist/content.js", "dist/insights-tracker.js", "dist/mini-game.js"]`; background `"service_worker": "dist/background.js"` and **stay classic** (no `"type":"module"` — module workers can't `importScripts`, which firebase compat needs). Nothing else changes.

**HTML** — Phase 1: `<script src>` → `dist/popup.js` / `dist/settings.js` / `dist/insights.js` (HTML still at root). Phase 2.5 moves the HTML into `src/<page>/` and copies it to `dist/` at build time, with same-dir relative refs (`popup.css`, `popup.js` — siblings in dist/); `manifest.json` `default_popup` and the two `chrome.runtime.getURL(...)` calls in `src/popup/index.ts` switch to `dist/...` paths.

**`publish.yml`** — test job: setup-node@v4 (node 20) + `npm ci`; replace per-file `node --check` with `npm test` + `npm run build`, add `npm run typecheck:baseline` in Phase 2, then switch to raw `npm run typecheck` in Phase 6; required-files check runs after build and looks for `dist/*.js`. Publish job: `npm ci` + `npm run build` before `zip`; zip list swaps loose JS for `dist/` → `zip -r extension.zip manifest.json dist/ popup.html popup.css settings.html settings.css insights.html insights.css content.css icons/ vendor/`. Never `src/`. After Phase 2.5 the loose CSS/HTML disappear from the zip too (dist/ ships them): `zip -r extension.zip manifest.json dist/ icons/ vendor/`.

## Phases

### Phase 1 — Tooling skeleton (no behavior change)

Add package.json/tsconfig/vitest.config/build.mjs (+eslint placeholder); `npm install`, commit lockfile. Seed `src/` by moving each current file essentially verbatim to its entry (`src/content/index.ts`, `src/tracker/index.ts`, `src/mini-game/index.ts`, `src/background/index.ts`, `src/popup/index.ts`, `src/settings/index.ts`, `src/insights/index.ts`); `sync.js` → `src/background/sync.ts` with `var alephSync = (...)()` → `export const alephSync = (...)()`; background `index.ts` opens with `importScripts(` the 4 vendor firebase files `)` (drops `importScripts("sync.js")`) + `import { alephSync }`. Update manifest/HTML paths to `dist/`; gitignore `dist/`; update publish.yml; add additive CLAUDE.md dev-loop note (source in `src/`, `npm run dev`, never edit `dist/`, repo root stays the unpacked dir).

- [x] build emits all 7 bundles; typecheck runs (**observed tsc baseline: 566 errors**; machine-enforced baseline lands at the start of Phase 2); test runs
- [x] unpacked reload at repo root → **extension ID unchanged** (`odaeo…` before/after), settings + history intact
- [x] all 3 platforms load (`data-aleph-*` attributes set; tracker logs from `dist/insights-tracker.js`), no new errors
- [x] SW healthy: firebase importScripts (root-absolute paths) boots; verified via second `aleph-reload` round-trip handled by the NEW background bundle + live insights message flow
- [ ] popup/settings/insights pages render and read storage *(extension pages are blocked to browser automation — needs a 5s human glance; bundles built, paths verified, SW message path alive)*
- [x] `aleph-reload` round-trip works (twice; second through the new bundle)
- [x] full `checks.md` sweep on RTL Claude session `claude-bidi-math-001`: rtl-direction PASS (51), math-ltr-isolation PASS (48), latex-rendered PASS (48/0 errors), streaming-attrs PASS, no-console-errors PASS

**Rollback:** revert → manifest/HTML point back at root JS; original files run as before.

### Phase 2 — Extract `src/shared/` (kill duplication)

First add `scripts/check-typecheck-baseline.mjs` plus a committed `tests/typecheck-baseline.json` seeded from the current `tsc --noEmit --pretty false` count (`566` as of Phase 1 review); wire `npm run typecheck:baseline` and publish CI to fail only when the count grows. Remove `passWithNoTests:true` so `npm test` cannot pass with an empty suite. Then create shared modules (`version`, `platform`, `defaults`+`Settings` type, `themes`, `pricing`, `platformMeta`, `dates`, `format`, `rtl`, `metricKeys`, `messages`); rewire all consumers, delete local copies (canonical winners per table above); both background and popup call the same `metricKeys` builders. Repoint `checks.md` KEEP-IN-SYNC comments (code untouched). Add `tests/unit/defaults-themes.spec.ts`, `tests/unit/metric-keys.spec.ts`, and `tests/unit/shared-helpers.spec.ts` (lock default keys, theme names, metric-key strings, date/format/platform/RTL helpers, selector unions).

- [x] `npm run typecheck:baseline` green (**552/552**); count shrank from 566 and `tests/typecheck-baseline.json` was updated in the same commit
- [x] `npm test` discovers and runs real unit tests (**13 tests**); no `passWithNoTests`
- [x] build+test+lint green; grep shows each migrated duplicated literal exists once under `src/shared/` (excluding intentional `tests/checks.md` console snippets and unit-test assertions)
- [ ] reload, all platforms clean
- [ ] settings delta verified: per-platform dropdowns gain "Default"; miniGame persists incl. reset + export/import round-trip
- [ ] popup meters render identically (shared keys match stored snapshots); insights spend/time render
- [ ] `checks.md` RTL sweep passes

**Rollback:** revert → consumers back to local literals. No storage/manifest impact.

### Phase 2.5 — Assets: CSS + HTML into src/, built to dist/

Best-practice grounding: extension frameworks (WXT/Plasmo/CRXJS) colocate entrypoint HTML+CSS with their feature's source and keep static pass-through assets at the package root. Our identity-constrained analog: HTML/CSS move into `src/<page>/`, build emits/copies them into `dist/`; `icons/` + `vendor/` stay at the repo root (which IS the package root; `/vendor/*` paths are load-bearing).

Steps (behavior-identical; CSS rule order preserved — rule 11):
1. `git mv` assets next to their code: `content.css → src/content/content.css` (verbatim; concern-split deferred to Phase 4), `popup.{html,css} → src/popup/`, `settings.{html,css} → src/settings/`, `insights.{html,css} → src/insights/`.
2. `build.mjs`: add 4 CSS entry points (esbuild bundles `.css` natively, inlines `@import`) → `dist/{content,popup,settings,insights}.css`; add a plain copy step for the 3 HTML files → `dist/*.html`. Edit the source HTML refs to same-dir relative (`<link href="popup.css">`, `<script src="popup.js">` — both siblings in dist/). `settings.html`'s back-link `href="popup.html"` stays valid (same dir).
3. Extract `src/shared/ui.css` containing **only byte-identical** page-chrome blocks (`.logo`; the shared toggle base) — each page CSS opens with `@import "../shared/ui.css";` so base rules still precede page rules. Divergent blocks (`.field` gap, `select`/range backgrounds `#2a2a4a` vs `#1a1a2e`, settings' toggle `border-top`) **stay per-page** — they differ on purpose.
4. `manifest.json`: `"default_popup": "dist/popup.html"`; content_scripts `"css": ["dist/content.css"]`.
5. `src/popup/index.ts`: `getURL("settings.html")` → `getURL("dist/settings.html")`, `getURL("insights.html")` → `getURL("dist/insights.html")`.
6. `publish.yml`: zip list shrinks to `manifest.json dist/ icons/ vendor/`; required-files check gains `dist/content.css` + `dist/popup.html`.
7. CLAUDE.md structure bullets: asset paths updated (small touch; full rewrite stays Phase 6).
8. Optional root tidy (separate commit, gated on grep showing zero inbound references): `COMPETITORS.md`, `EXAMPLES.md`, `store-listing.md` → `docs/`. **Keep at root**: `README.md`, `LICENSE`, `CLAUDE.md` + `AGENTS.md` symlink, `PRIVACY.md` (the Web Store listing may deep-link its GitHub blob URL — verify before ever moving), `MIGRATION.md` (deleted in Phase 6 anyway).

- [ ] build emits 7 JS + 4 CSS + 3 HTML into dist/; `npm test` + `npm run typecheck:baseline` green
- [ ] reload → popup opens from `dist/popup.html` (toolbar click); settings/insights open via popup buttons; settings back-link returns to popup
- [ ] content.css still injected (path-only change): `theme-applied`, `focus-hidden`, `streaming-attrs`, `rtl-direction` PASS on an RTL session (all depend on content.css rules)
- [ ] page styling pixel-identical (ui.css extraction is visually invisible): popup/settings/insights eyeball
- [ ] extension ID unchanged; publish zip list reviewed

**Rollback:** revert → assets back at root, paths restored. No storage impact.

### Phase 3 — Split tracker + port fixtures to vitest

Split per seams: `send`/`tokens`/`time`/`messages`/`timing`/`plans`/`usageClaude`/`usageChatgpt`/`usageGemini`/`modelCaps`; `index.ts` keeps the boot orchestration (3s setTimeout, 60s intervals, detect kickoffs). Export test targets (`normalizeChatgptPlan`, `CHATGPT_PLAN_RANK`, `normalizeCodexBalance`, gemini credits parser, `estimateTokens`). WeakSet/WeakMap and plan-state lets each live in exactly one owning module. Port PR #1 fixtures → `plans.spec.ts`, `codex.spec.ts`, `gemini.spec.ts`.

- [ ] build+test green (new specs cover every exported normalizer/helper); `npm run typecheck:baseline` green and baseline updated only if lower
- [ ] reload: tracker boots on all platforms; send a message per platform → counts/time/tokens update in popup
- [ ] subscription plan + usage meters (Claude 5h/7d, ChatGPT/Codex, Gemini credits) all render
- [ ] no double-counting on repeated messages (single WeakSet owner)
- [ ] `no-console-errors` + `rtl-direction` on an RTL session

**Rollback:** revert → single-module tracker. Wire untouched.

### Phase 4 — Split content.js (highest-risk split)

`settingsStore.ts` first — mutable settings behind `getSettings()`/`setSettings()` (never `export let` reassigned cross-module). Then `selectors`/`fonts`/`theme`/`bidi` (owns `patching` flag, editor-dir WeakMap, `hintChecked`, `sendHint`)/`focus`/`streaming`/`latex` (large, pure)/`styles`/`badge`; `index.ts` keeps `ensureRootAttributes` (sets `data-aleph-platform` + `data-aleph-ext-id` early), storage `onChanged` listener, `toggle` listener, both MutationObservers, boot chain, banner. Also split `src/content/content.css` into `src/content/styles/{bidi,streaming,focus,theme-transitions,platform-fixes}.css` (mirroring its existing section banners at lines 1-106/108-358/360-367/369-380/382-399), with `content.css` reduced to ordered `@import`s **matching the original section order exactly** (rule 11).

- [ ] build+test green; add focused unit tests for extracted pure content logic (RTL detection, theme resolution/style generation, selector unions, latex helpers); `npm run typecheck:baseline` count drops or at least does not grow
- [ ] reload all 3 platforms; banner present; `data-aleph-ext-id` on `<html>` verified explicitly
- [ ] **live settings path**: change theme/font/focus in popup with page open → content reacts without page reload
- [ ] checks: `rtl-direction` (Hebrew AND Arabic), `math-ltr-isolation`, `latex-rendered`, `theme-applied`, `focus-hidden`, `streaming-attrs`, `selectors-match`, `no-console-errors`
- [ ] typography/code-font/chat-width apply; Alt+Shift+A toggles with badge OFF

**Rollback:** revert → single-file content. No storage/manifest change.

### Phase 5 — Split background + popup; type small pages

Background: `sync.ts` exports public API + `_mergeUsageDay` (+helpers) for tests, `declare const firebase: any`, behavior identical; `index.ts` statement order: importScripts(4 vendor files) → init guard → `alephSync.init/restoreAuth`; **every background submodule must be side-effect-free at import time** (esbuild hoists bundled imports above the importScripts call — the single riskiest property; verify in SW console). Split `usage` (readLocal/writeLocal→`alephSync.maybePush`, updateUsageDay queue), `metrics`, `remarks`, `cleanup`, `router` (all listeners incl. onMessageExternal + commands + onInstalled/onStartup + storage.onChanged push). Popup: `meters`/`insightsView`/`ui`/`index`. Settings/insights/mini-game become clean TS modules importing shared. Add `mergeUsageDay.spec.ts`, finish `metrics.spec.ts`.

- [ ] build+test green (all 6 spec files plus any new router/sync/popup pure-helper specs); bg+popup+pages typed enough that `npm run typecheck:baseline` count drops or at least does not grow
- [ ] SW console: firebase init order correct, no reorder errors
- [ ] message round-trips: `insights-get-summary` (popup+insights), insights-* writes, `aleph-sync-status` in settings
- [ ] `aleph-reload` external message still reloads; Alt+Shift+A works; onInstalled/onStartup clean
- [ ] popup full pass: toggles, theme grid, overrides, sliders, export/import (incl. miniGame), buttons
- [ ] sync: signed-in `aleph-sync-now` completes (or clean signed-out state)
- [ ] reload + `no-console-errors` on all 3 platforms

**Rollback:** revert restores `importScripts("sync.js")` + relocated sync together; verify firebase still inits after revert.

### Phase 6 — Strict finish, ESLint, PR CI, docs, cleanup, mark ready

Drive `tsc --noEmit` to zero under full strict; remove `allowJs`; real types replace transitional `any`; remove the baseline file/script or leave `typecheck:baseline` as a strict alias to raw typecheck. ESLint flat config (typescript-eslint recommended; calibrate `no-floating-promises` for the fire-and-forget style). New `.github/workflows/ci.yml` on `pull_request`: `npm ci` → typecheck (required) → test → build; flip publish.yml typecheck to required and keep `npm test` as a required gate that fails on empty suites. Rewrite CLAUDE.md architecture ("no build step" → TS/esbuild reality, dev loop, never move manifest, never edit dist/, where canonical constants live, updated Common Tasks) and codify the test policy for future work. **Delete MIGRATION.md.** Mark PR #2 ready.

- [ ] `npm run check` fully green; zero tsc errors, no allowJs; lint clean
- [ ] transitional typecheck baseline removed or converted to a strict zero-error alias
- [ ] CI and CLAUDE.md require tests for behavioral changes, or an explicit documented reason when automation is impractical
- [ ] PR CI green on the PR; publish.yml reviewed (build precedes zip; dist/ in, src/ out)
- [ ] final full regression: all `checks.md` checks on RTL Claude + ChatGPT + Gemini; popup/settings/insights/sync/mini-game; extension ID unchanged; storage intact
- [ ] MIGRATION.md deleted; CLAUDE.md updated; `AGENTS.md` symlink still resolves
- [ ] PR #2 marked ready → **merge after user approval**

## Riskiest steps (read before the relevant phase)

1. **esbuild import-hoisting vs `importScripts` (P5):** bundled imports execute above the entry's own statements — background submodules must do nothing firebase-touching at import time. The init guard genuinely fires (real apiKey); verify in SW console, don't assume.
2. **Mutable `settings` live binding (P4):** getter/setter or singleton holder; reassignment only inside `settingsStore.ts`. Dedicated live-update check.
3. **WeakMap/WeakSet/flag single-ownership (P3/P4):** duplicated state = double counting / re-patching. One owner module each.
4. **Unicode property regexes through esbuild (P2–P4):** `target:chrome120` keeps `\p{Script=…}` native; minify off; verify Hebrew AND Arabic post-build.
5. **Three content bundles share one isolated world (P1+):** keep them separate entries; never import stateful singletons across content/tracker/mini-game bundles (imports duplicate code per bundle); tiny stateless consts are fine.
6. **`writeLocal`→`alephSync.maybePush` (P5):** `usage.ts` imports `sync.ts`; no reverse import (cycle).
7. **Export/import filter (P2):** `Object.keys(DEFAULTS)` gate now includes miniGame — verify round-trip.
8. **publish zip must ship `dist/` (P1/P6):** dist is gitignored — workflow must build before zip or the zip ships no code.
9. **CSS rule order is part of the contract (P2.5/P4):** equal-specificity rules must keep their relative order; split files are imported in original-section order, never alphabetized. Shared `ui.css` may only absorb byte-identical blocks.
10. **esbuild CSS bundling (P2.5):** `@import` inlining only; no `url()` assets exist in any CSS today (verified) — if one appears later, configure the asset loader before relying on it.
11. **Pages live in dist/ after P2.5:** `default_popup` and `getURL` targets require a build before the popup is openable — same property the JS bundles already have; watch mode covers the dev loop.

## Post-migration candidates (explicitly NOT in scope)

- CSS design tokens: platform colors (`#D97706/#4285F4/#10A37F`) and surface colors repeat ~10× across page CSS and also exist in JS `PLATFORM_COLORS` — converting to CSS custom properties is a behavior-affecting refactor; do it (if at all) after Phase 6 with visual diffing.
- Moving `icons/`/`vendor/` or generating `manifest.json`: ruled out by the identity constraint and load-bearing absolute paths.

## Progress-tracking convention

One phase = one commit, subject `migration(phase N): <summary>`; tick that phase's checkboxes in the same commit; never tick unverified boxes; the MIGRATION.md deletion commit signals code-complete → PR ready → merge.
