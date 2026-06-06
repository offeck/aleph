import { VERSION } from "../shared/version";
import { updateBadge } from "./badge";
import { cleanupEditorDir, hasPendingHintWork, patchBidi, updateBidiRootAttribute } from "./bidi";
import { applyFocusMode } from "./focus";
import { hasPendingLatexWork, patchLatex, patchMathText } from "./latex";
import { PLATFORM } from "./platform";
import { applySettingsChange, getSettings, isPlatformEnabled, loadSettings } from "./settingsStore";
import { applyStreamSmooth } from "./streaming";
import { applyStyles, STYLE_ID } from "./styles";
import { debounceDelay, isAlephAuthored, setOnPending, takePatchRoots, type PatchRootQueues } from "./rescan";

declare const __ALEPH_BUILD__: string;

// ── Boot orchestration ───────────────────────────────────────────────────
// Modules only define; everything observable starts here, gated on a
// supported platform (manifest matches keep this always-true in practice).

function ensureRootAttributes() {
  if (!PLATFORM) return;
  document.documentElement.setAttribute("data-aleph-platform", PLATFORM);
  document.documentElement.setAttribute("data-aleph-build", __ALEPH_BUILD__);
  if (chrome?.runtime?.id) document.documentElement.setAttribute("data-aleph-ext-id", chrome.runtime.id);
}

// Reentrancy guard around the whole patch pass; scheduleUpdate() consults it
// so our own DOM writes don't re-trigger a patch via the MutationObserver.
let patching = false;

// Dirty-set: the observer records mutated elements and the scanners process
// only those subtrees/ancestors (see collectCandidates in rescan.ts), so
// per-pass cost tracks what changed, not total conversation size. Continuation
// leftovers live in their own queue so a non-event slice cannot consume real
// mutation roots before focus/editor/list event work sees them.
const rootQueues: PatchRootQueues = {
  dirtyRoots: new Set<Element>(),
  continuationRoots: new Set<Element>(),
  fullPassNeeded: true,
};

function markDirty(n: Node) {
  const el = n.nodeType === 1 ? (n as Element) : n.parentElement;
  if (el) rootQueues.dirtyRoots.add(el);
}

// ── Reactive scheduling ────────────────────────────────────────────────
// No standing scan loop. Work runs from four event-driven sources:
//  1. scheduleUpdate() — debounced observer mutations (QUIET_MS of silence,
//     forced at MAX_WAIT_MS so continuous streaming can't starve passes);
//  2. scheduleContinuation() — each pass is budgeted to SLICE_BUDGET_MS and
//     re-queues unprocessed elements, so first-decoration of a huge
//     conversation interleaves with paint instead of blocking;
//  3. requestDrain() — self-canceling timer that exists only while a scanner
//     parked observer-invisible work (ChatGPT stream-end class changes,
//     hint-window expiry) and stops when those sets drain;
//  4. a 30s attribute-recovery heartbeat (the one standing timer).
const QUIET_MS = 120;
const MAX_WAIT_MS = 500;
const SLICE_BUDGET_MS = 12;
const CONTINUE_DELAY_MS = 30;
const DRAIN_MS = 500;

let contTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleContinuation() {
  if (contTimer) return;
  contTimer = setTimeout(() => { contTimer = null; patchAll(false); }, CONTINUE_DELAY_MS);
}

let drainTimer: ReturnType<typeof setTimeout> | null = null;
function requestDrain() {
  if (drainTimer) return;
  drainTimer = setTimeout(() => {
    drainTimer = null;
    patchAll(false);
    if (hasPendingLatexWork() || hasPendingHintWork()) requestDrain();
  }, DRAIN_MS);
}

function ensureStreamAnimAttr() {
  const settings = getSettings();
  if (!settings.streamSmooth) return;
  const anim = settings.streamAnimation || "platform";
  if (document.documentElement.getAttribute("data-aleph-stream-anim") !== anim) {
    document.documentElement.setAttribute("data-aleph-stream-anim", anim);
  }
}

// eventPass: false on continuation/drain slices — those only advance our own
// decoration work, so unscoped per-pass scans that react to real page
// mutations (focus mode, the bidi list sweep, editor attachment) skip them.
function patchAll(eventPass = true) {
  ensureRootAttributes();
  updateBidiRootAttribute();
  if (patching || !isPlatformEnabled()) return;
  patching = true;
  try {
    const roots = takePatchRoots(rootQueues, eventPass);
    const deadline = performance.now() + SLICE_BUDGET_MS;
    const settings = getSettings();
    const leftovers: Element[] = [];
    if (settings.bidiEnabled) leftovers.push(...patchBidi(roots, deadline, eventPass));
    else cleanupEditorDir();
    if (settings.focusMode && eventPass) applyFocusMode();
    if (settings.latexFix) leftovers.push(...patchLatex(roots, deadline));
    if (settings.bidiEnabled) leftovers.push(...patchMathText(roots, deadline));
    if (settings.streamSmooth) {
      applyStreamSmooth();
      ensureStreamAnimAttr();
    }
    if (leftovers.length) {
      for (const el of leftovers) rootQueues.continuationRoots.add(el);
      scheduleContinuation();
    }
  } finally {
    patching = false;
  }
}

// ── Observer (scoped to relevant mutations) ────────────────────────────
let timer: ReturnType<typeof setTimeout> | null = null;
let firstMutationAt = 0;
function scheduleUpdate() {
  if (patching) return;
  const now = Date.now();
  if (timer) clearTimeout(timer);
  else firstMutationAt = now;
  timer = setTimeout(() => { timer = null; patchAll(); }, debounceDelay(now, firstMutationAt, QUIET_MS, MAX_WAIT_MS));
}

if (PLATFORM) {
  ensureRootAttributes();

  if (chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "sync") {
        for (const [key, { newValue }] of Object.entries(changes)) {
          applySettingsChange(key, newValue);
        }
        applyStyles();
        rootQueues.fullPassNeeded = true;
        patchAll();
        updateBadge();
      }
    });
  }

  // ── Toggle handler (keyboard shortcut) ─────────────────────────────────
  if (chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === "toggle" && PLATFORM) {
        const key = "enable" + PLATFORM.charAt(0).toUpperCase() + PLATFORM.slice(1);
        const newVal = !isPlatformEnabled();
        if (chrome?.storage?.sync) {
          chrome.storage.sync.set({ [key]: newVal });
        }
      }
    });
  }

  new MutationObserver((mutations) => {
    let relevant = false;
    for (const m of mutations) {
      const target = m.target as Element;
      if (target === document.head || target.closest?.("head")) continue;
      if (target.id === STYLE_ID) continue;
      // Our own DOM writes (latex/math wrappers, mini-game overlay) must not
      // re-trigger a patch pass — the `patching` flag can't catch them because
      // observer callbacks are delivered after the synchronous pass ends.
      if (isAlephAuthored(target)) continue;
      if (
        m.type === "childList" && m.addedNodes.length > 0 &&
        Array.from(m.addedNodes).every(isAlephAuthored) &&
        Array.from(m.removedNodes).every((n) => n.nodeType === 3 || isAlephAuthored(n))
      ) continue;
      markDirty(target);
      relevant = true;
    }
    if (relevant) scheduleUpdate();
  }).observe(document.body, {
    childList: true, subtree: true, characterData: true,
  });

  // ── Boot ───────────────────────────────────────────────────────────────
  setOnPending(requestDrain);
  loadSettings().then(() => {
    applyStyles();
    patchAll();
    updateBadge();
    setTimeout(() => { applyStyles(); rootQueues.fullPassNeeded = true; patchAll(); }, 1500);

    // Attribute-recovery heartbeat — the one standing timer. <html>
    // attributes can be stripped by SPA rewrites that never touch body's
    // subtree; everything else is event-driven (see Reactive scheduling).
    setInterval(() => {
      ensureRootAttributes();
      updateBidiRootAttribute();
      if (isPlatformEnabled()) ensureStreamAnimAttr();
    }, 30000);
  });

  console.log(
    `%c[Aleph v${VERSION}] loaded on ${PLATFORM} (build ${__ALEPH_BUILD__})`,
    "color:#4ade80;font-weight:bold;font-size:14px"
  );
}
