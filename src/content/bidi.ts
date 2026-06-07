import { EDITOR_BIDI_STYLE_ID } from "../shared/domIds";
import { RTL_SCRIPT_LETTER_RE } from "../shared/rtl";
import { blockDir, buildEditorBidiCss, SCOPE_ATTR, type EditorScopeBlocks } from "./editorBidi";
import { SEL } from "./selectors";
import { getSettings, isPlatformEnabled } from "./settingsStore";
import { collectCandidates, notifyPending, textOf } from "./rescan";

// ── BiDi Detection ─────────────────────────────────────────────────────
function isMathNode(node: Element) {
  const tag = node.tagName?.toLowerCase();
  return node.classList?.contains("katex") || node.classList?.contains("katex-display") ||
    tag === "mjx-container" || tag === "code" || tag === "pre";
}

export function hasRTLScriptText(text: string | null | undefined): boolean {
  return RTL_SCRIPT_LETTER_RE.test(text || "");
}

function hasRTL(el: Element): boolean {
  if (!el) return false;
  for (const c of el.childNodes) {
    if (c.nodeType === 3 && hasRTLScriptText(c.textContent)) return true;
    if (c.nodeType === 1) {
      const child = c as Element;
      if (isMathNode(child)) continue;
      if (hasRTL(child)) return true;
    }
  }
  return false;
}

// ── Send hint (set by insights-tracker.js via DOM attribute) ─────────
interface SendHint {
  ts: number;
  lang: string;
  len: number;
  words: number;
}

let sendHint: SendHint | null = null;
const HINT_WINDOW = 30000;
const hintChecked = new WeakSet<Element>();
// Elements carrying an optimistic hint mark, pending confirmation by real
// RTL text. Scoped passes never revisit an element whose text doesn't
// change, so without this set a hint applied to text that never turns RTL
// would stick forever (patchBidi re-validates the set every pass; adding
// calls notifyPending() so index.ts's drain keeps passes coming until the
// hint window resolves).
const hintApplied = new Set<Element>();

export function hasPendingHintWork(): boolean {
  return hintApplied.size > 0;
}

function readSendHint() {
  const raw = document.documentElement.getAttribute("data-aleph-send-hint");
  if (!raw) { sendHint = null; return; }
  if (!document.documentElement.hasAttribute("data-aleph-thinking")) { sendHint = null; return; }
  try {
    const h = JSON.parse(raw);
    const elapsed = Date.now() - h.ts;
    if (elapsed < HINT_WINDOW) { sendHint = h; return; }
    sendHint = null;
    document.documentElement.removeAttribute("data-aleph-send-hint");
  } catch (e) { sendHint = null; }
}

// ── BiDi Patcher ───────────────────────────────────────────────────────
const EDITOR_DIR_BLOCKS = "p, div, li";

export function updateBidiRootAttribute() {
  if (isPlatformEnabled() && getSettings().bidiEnabled) {
    document.documentElement.setAttribute("data-aleph-bidi-enabled", "true");
  } else {
    document.documentElement.removeAttribute("data-aleph-bidi-enabled");
  }
}

// Per-element processed-state: skips the recursive hasRTL walk + attribute
// reconcile while the element's exact text is unchanged, and remembers the
// verdict so the cheap skip path can re-assert a stripped attribute —
// attribute mutations aren't observed, so a platform rewrite could
// otherwise un-mark an element forever.
const bidiSeen = new WeakMap<Element, { text: string; rtl: boolean }>();

// roots: mutated elements from the observer (scoped pass), or null for a
// full-document pass — see collectCandidates in rescan.ts. Returns elements
// left unprocessed when the time budget (`deadline`, performance.now()
// epoch) ran out — the caller re-queues them for a continuation slice.
// eventPass: false on continuation/drain slices — those only advance our own
// decoration work, so the list sweep and editor scan (which react to real
// page mutations) are deferred to the next event-driven pass.
export function patchBidi(roots: Element[] | null = null, deadline = 0, eventPass = true): Element[] {
  readSendHint();
  const textSel = SEL.text.join(", ");
  const remainder: Element[] = [];
  // Hard-progress rule: the first element that needs real work runs even if
  // the budget is already spent — a slice always advances, so no element can
  // livelock the continuation chain. hasRTL itself stays atomic per element:
  // it early-exits on the first RTL character and skips math/code subtrees,
  // so its worst case is bounded by one message body's text, not the page.
  let processedOne = false;
  let rtlChanged = false;
  for (const el of collectCandidates(roots, textSel)) {
    if (processedOne && deadline && performance.now() > deadline) { remainder.push(el); continue; }
    if (el.closest(".katex") || el.closest("mjx-container")) continue;
    const text = textOf(el);
    const prev = bidiSeen.get(el);
    if (prev && prev.text === text) {
      // Self-heal on the cheap path: re-assert a stripped mark without
      // re-walking (text unchanged ⇒ the stored verdict still holds).
      if (prev.rtl && el.getAttribute("data-aleph-rtl") !== "true") {
        el.setAttribute("data-aleph-rtl", "true");
        el.removeAttribute("data-aleph-dir");
        reconcileListParent(el);
        rtlChanged = true;
      }
      continue;
    }
    processedOne = true;
    const has = el.getAttribute("data-aleph-rtl");
    if (!has && sendHint && sendHint.lang === "rtl" && !hintChecked.has(el)) {
      hintChecked.add(el);
      if ((el.textContent || "").trim().length < 200) {
        el.setAttribute("data-aleph-rtl", "true");
        el.removeAttribute("data-aleph-dir");
        hintApplied.add(el);
        notifyPending();
        rtlChanged = true;
      }
    }
    const need = hasRTL(el);
    if (need && has !== "true") {
      el.setAttribute("data-aleph-rtl", "true");
      el.removeAttribute("data-aleph-dir");
      rtlChanged = true;
    } else if (need && has === "true") {
      el.removeAttribute("data-aleph-dir");
    } else if (!need && has === "true") {
      el.removeAttribute("data-aleph-rtl");
      el.removeAttribute("data-aleph-dir");
      rtlChanged = true;
    }
    reconcileListParent(el);
    bidiSeen.set(el, { text, rtl: el.getAttribute("data-aleph-rtl") === "true" });
  }

  // Re-validate optimistic hint marks: confirmed by real RTL text → done;
  // hint window closed (sendHint null) with still no RTL text → remove the
  // stale mark. Runs every pass over the (small) applied set.
  for (const el of [...hintApplied]) {
    if (!el.isConnected) { hintApplied.delete(el); continue; }
    if (hasRTL(el)) { hintApplied.delete(el); continue; }
    if (!sendHint) {
      if (el.getAttribute("data-aleph-rtl") === "true") {
        el.removeAttribute("data-aleph-rtl");
        el.removeAttribute("data-aleph-dir");
        reconcileListParent(el);
        rtlChanged = true;
        // Keep the stored verdict in sync so the skip-path heal can't
        // re-assert the mark this validator just removed.
        const prev = bidiSeen.get(el);
        if (prev) bidiSeen.set(el, { text: prev.text, rtl: false });
      }
      hintApplied.delete(el);
    }
  }

  // Unmark lists whose RTL items were removed outright — a removal never
  // visits the list (the li is gone and the ul isn't in SEL.text). Runs on
  // event-driven passes (real page mutations) and whenever this pass changed
  // any rtl mark; continuation slices only advance our own decoration and
  // skip it. The former :has() selector did this implicitly.
  if (eventPass || rtlChanged) {
    document.querySelectorAll("[data-aleph-rtl-list]").forEach((list) => {
      if (!list.querySelector(':scope > [data-aleph-rtl="true"]')) {
        list.removeAttribute("data-aleph-rtl-list");
      }
    });
  }

  // Editor sync on event passes: attaches input listeners to new editors and
  // re-syncs the scoped stylesheet (read-compute-compare — see syncEditors),
  // which also covers programmatically populated drafts.
  if (eventPass) syncEditors();
  return remainder;
}

// Lists: mark the parent list of RTL items with a plain attribute so the
// CSS can match `ul[data-aleph-rtl-list]` instead of `ul:has(> [data-aleph-rtl])`
// — ancestor :has() invalidation re-runs on every child mutation and is a
// page-wide style-recalc tax on large conversations.
function reconcileListParent(el: Element) {
  const list = el.parentElement;
  if (!list) return;
  const tag = list.tagName;
  if (tag !== "UL" && tag !== "OL") return;
  if (el.getAttribute("data-aleph-rtl") === "true") {
    if (list.getAttribute("data-aleph-rtl-list") !== "true") {
      list.setAttribute("data-aleph-rtl-list", "true");
    }
  } else if (list.hasAttribute("data-aleph-rtl-list") &&
             !list.querySelector(':scope > [data-aleph-rtl="true"]')) {
    list.removeAttribute("data-aleph-rtl-list");
  }
}

function setDirAutoForText(el: Element, text: string | null | undefined) {
  const hasText = (text || "").trim().length > 0;
  if (hasText && el.getAttribute("dir") !== "auto") {
    el.setAttribute("dir", "auto");
  } else if (!hasText && el.getAttribute("dir") === "auto") {
    el.removeAttribute("dir");
  }
}

// ── Composer BiDi (loop-safe by construction) ──────────────────────────
// Aleph never writes into contenteditable subtrees: ProseMirror/Quill
// reconcile them and revert foreign dir attributes, which (with the former
// per-editor MutationObserver + rAF/80ms/250ms fan-out) self-sustained a
// ~300Hz write→revert loop whenever the composer held text. Instead, RTL
// blocks are styled from an Aleph-owned <style> in document.head (the body
// observer never sees it) keyed by a scope attribute on the nearest
// non-contenteditable ancestor (attribute mutations aren't observed either).
// Recomputation is event-driven (input/compositionend → one coalesced rAF)
// plus the read-compute-compare sync on event passes; the stylesheet is
// rewritten only when the computed CSS string changes, so a host re-render
// that alters nothing settles in silence. Known limitation: :nth-child
// indexes can be stale for ≤ one event-pass cadence after non-input DOM
// reshuffles; the next input event or event pass re-syncs.
const editorListenersAttached = new WeakSet<Element>();
const editorHealed = new WeakSet<Element>();
const editorScopeIds = new WeakMap<Element, string>();
let nextScopeId = 1;
let editorSyncPending = false;

function scheduleEditorSync() {
  if (editorSyncPending) return;
  editorSyncPending = true;
  requestAnimationFrame(() => {
    editorSyncPending = false;
    syncEditors();
  });
}

function attachEditorListeners(ed: Element) {
  if (editorListenersAttached.has(ed)) return;
  editorListenersAttached.add(ed);
  ed.addEventListener("input", scheduleEditorSync);
  ed.addEventListener("compositionend", scheduleEditorSync);
}

// One-shot heal: strip dir="auto" that previous builds wrote onto
// contenteditable roots/children (this build never writes there). At most
// one host re-render per editor, then permanent silence.
function healStaleEditorDir(ed: Element) {
  if (editorHealed.has(ed)) return;
  editorHealed.add(ed);
  if (ed.getAttribute("dir") === "auto") ed.removeAttribute("dir");
  ed.querySelectorAll(EDITOR_DIR_BLOCKS).forEach((child) => {
    if (child.getAttribute("dir") === "auto") child.removeAttribute("dir");
  });
}

// Nearest non-contenteditable ancestor: hosts manage the editable root's
// attributes (container dir="auto" was a c7bb26f loop trigger), not its
// wrapper's.
function scopeHostFor(ed: Element): Element | null {
  let p = ed.parentElement;
  while (p && (p as HTMLElement).isContentEditable) p = p.parentElement;
  return p;
}

function writeEditorBidiCss(css: string) {
  const styleEl = document.getElementById(EDITOR_BIDI_STYLE_ID);
  if (!css) {
    if (styleEl) styleEl.remove();
    return;
  }
  if (!styleEl) {
    const el = document.createElement("style");
    el.id = EDITOR_BIDI_STYLE_ID;
    el.textContent = css;
    document.head.appendChild(el);
  } else if (styleEl.textContent !== css) {
    styleEl.textContent = css;
  }
}

function syncEditors() {
  if (!isPlatformEnabled() || !getSettings().bidiEnabled) return;
  const scopes: EditorScopeBlocks[] = [];
  const seen = new Set<Element>();
  SEL.editor.forEach((sel) => {
    document.querySelectorAll(sel).forEach((ed) => {
      if (seen.has(ed)) return;
      seen.add(ed);
      attachEditorListeners(ed);
      const value = (ed as HTMLTextAreaElement).value;
      if (value !== undefined) {
        // textarea/input: not framework-reconciled and no childList churn —
        // a direct dir="auto" write cannot feed back.
        setDirAutoForText(ed, value);
        return;
      }
      healStaleEditorDir(ed);
      const host = scopeHostFor(ed);
      if (!host) return;
      let id = editorScopeIds.get(ed);
      if (!id) {
        id = "e" + nextScopeId++;
        editorScopeIds.set(ed, id);
      }
      // Re-ensure each sync — the host wrapper can be recreated by the app.
      if (host.getAttribute(SCOPE_ATTR) !== id) host.setAttribute(SCOPE_ATTR, id);
      // Every descendant block (not just direct children): nested composer
      // structures like ul > li keep per-block direction, matching the old
      // per-descendant dir="auto" behavior.
      const rtlPaths: number[][] = [];
      ed.querySelectorAll(EDITOR_DIR_BLOCKS).forEach((block) => {
        if (blockDir(block.textContent) !== "rtl") return;
        const path: number[] = [];
        let cur: Element | null = block;
        while (cur && cur !== ed) {
          const parent: Element | null = cur.parentElement;
          if (!parent) return; // detached mid-scan
          path.unshift(Array.prototype.indexOf.call(parent.children, cur) + 1);
          cur = parent;
        }
        if (cur === ed) rtlPaths.push(path);
      });
      if (rtlPaths.length) scopes.push({ id, rtlPaths });
    });
  });
  writeEditorBidiCss(buildEditorBidiCss(scopes));
}

export function cleanupEditorDir() {
  SEL.editor.forEach((sel) => {
    document.querySelectorAll(sel).forEach((ed) => {
      if (ed.getAttribute("dir") === "auto") ed.removeAttribute("dir");
      ed.querySelectorAll(EDITOR_DIR_BLOCKS).forEach((child) => {
        if (child.getAttribute("dir") === "auto") child.removeAttribute("dir");
      });
    });
  });
  document.querySelectorAll(`[${SCOPE_ATTR}]`).forEach((el) => el.removeAttribute(SCOPE_ATTR));
  const styleEl = document.getElementById(EDITOR_BIDI_STYLE_ID);
  if (styleEl) styleEl.remove();
}
