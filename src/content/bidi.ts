import { RTL_SCRIPT_LETTER_RE } from "../shared/rtl";
import { SEL } from "./selectors";
import { getSettings, isPlatformEnabled } from "./settingsStore";

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

export function patchBidi() {
  readSendHint();
  const textSel = SEL.text.join(", ");
  document.querySelectorAll(textSel).forEach((el) => {
    if (el.closest(".katex") || el.closest("mjx-container")) return;
    const has = el.getAttribute("data-aleph-rtl");
    if (!has && sendHint && sendHint.lang === "rtl" && !hintChecked.has(el)) {
      hintChecked.add(el);
      if ((el.textContent || "").trim().length < 200) {
        el.setAttribute("data-aleph-rtl", "true");
        el.removeAttribute("data-aleph-dir");
      }
    }
    const need = hasRTL(el);
    if (need && has !== "true") {
      el.setAttribute("data-aleph-rtl", "true");
      el.removeAttribute("data-aleph-dir");
    } else if (need && has === "true") {
      el.removeAttribute("data-aleph-dir");
    } else if (!need && has === "true") {
      el.removeAttribute("data-aleph-rtl");
      el.removeAttribute("data-aleph-dir");
    }
  });

  patchEditors();
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
