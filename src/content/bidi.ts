import { RTL_SCRIPT_LETTER_RE } from "../shared/rtl";
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
const editorDirObservers = new WeakMap<Element, MutationObserver>();
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

  // New editors only appear via real page mutations; once attached they
  // self-maintain through their own listeners/observer.
  if (eventPass) patchEditors();
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

function patchEditorDir(ed: Element) {
  const value = (ed as HTMLTextAreaElement).value;
  const text = value !== undefined ? value : ed.textContent;
  setDirAutoForText(ed, text);

  if (value === undefined) {
    ed.querySelectorAll(EDITOR_DIR_BLOCKS).forEach((child) => {
      setDirAutoForText(child, child.textContent);
    });
  }
}

function scheduleEditorDirPatch(ed: Element) {
  requestAnimationFrame(() => patchEditorDir(ed));
  setTimeout(() => patchEditorDir(ed), 80);
  setTimeout(() => patchEditorDir(ed), 250);
}

function ensureEditorDirObserver(ed: Element) {
  if (editorDirObservers.has(ed)) return;

  const onInput = () => scheduleEditorDirPatch(ed);
  ed.addEventListener("beforeinput", onInput);
  ed.addEventListener("input", onInput);
  ed.addEventListener("keyup", onInput);
  ed.addEventListener("compositionend", onInput);

  const observer = new MutationObserver(() => scheduleEditorDirPatch(ed));
  observer.observe(ed, {
    childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ["dir"],
  });
  editorDirObservers.set(ed, observer);
}

function patchEditors() {
  SEL.editor.forEach((sel) => {
    document.querySelectorAll(sel).forEach((ed) => {
      patchEditorDir(ed);
      ensureEditorDirObserver(ed);
    });
  });
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
}
