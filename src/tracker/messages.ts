import { USER_MESSAGE_MARKERS } from "../shared/messageMarkers";
import { countRTLScriptLetters } from "../shared/rtl";
import { send, type TrackerMessage } from "./send";
import { PLATFORM } from "./platform";
import { estimateMessage, type MessageEstimate } from "./tokens";
import { getCurrentModel } from "./modelCaps";
import { beginResponseTiming, getUserSentAt, markUserSent } from "./timing";

// ── Message selectors (tracker-specific subset; content selectors live in shared/selectors.ts) ──
const MSG_WRAPPER = {
  claude:  ["[data-testid='user-message']", ".font-claude-response"],
  chatgpt: ["[data-testid^='conversation-turn']"],
  gemini:  ["model-response", ".conversation-turn", ".query-content"],
};
const ASSISTANT_MARKER = {
  claude:  [".font-claude-response"],
  chatgpt: ["[data-message-author-role='assistant']"],
  gemini:  [".response-content", ".model-response-text", "message-content"],
};
const USER_MARKER = USER_MESSAGE_MARKERS;

// ── Message counting + token estimation ──────────────────
const countedMessages = new WeakSet();
let graceUntil = 0;

export function setGraceUntil(ts: number) {
  graceUntil = ts;
}

const EDITOR_SEL = "[contenteditable], textarea, #prompt-textarea, .ProseMirror, .ql-editor, rich-textarea";
let lastEditorText = "";

function captureAndSignal(source: string) {
  let text = "";
  for (const sel of [".ProseMirror", "#prompt-textarea", ".ql-editor"]) {
    const ed = document.querySelector(sel);
    if (ed) { text = (ed.textContent || "").trim(); break; }
  }
  if (!text && lastEditorText) text = lastEditorText;
  if (!text) {
    markUserSent();
    return;
  }

  const stripped = text.replace(/\s/g, "");
  const rtlCount = countRTLScriptLetters(stripped);
  const strippedLength = Array.from(stripped).length;
  const lang = strippedLength > 0 && rtlCount / strippedLength > 0.3 ? "rtl" : "other";
  const words = text.split(/\s+/).filter(Boolean).length;

  const sentAt = markUserSent();
  beginResponseTiming();

  document.documentElement.setAttribute("data-aleph-send-hint", JSON.stringify({
    ts: sentAt, lang, len: text.length, words,
  }));

  send({
    type: "insights-send-analytics",
    platform: PLATFORM, lang, length: text.length, words, timestamp: sentAt,
  });

  console.log("[Aleph] send detected (" + source + ") lang=" + lang + " len=" + text.length);
}

export function startEditorCapture() {
  window.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      if ((e.target as Element | null)?.closest?.(EDITOR_SEL)) {
        captureAndSignal("Enter");
      }
    }
  }, true);
  window.addEventListener("click", (e) => {
    const btn = (e.target as Element | null)?.closest?.("button");
    if (!btn) return;
    const form = btn.closest("form, fieldset, [class*='composer'], [class*='input-container'], [class*='chat-input']");
    if (form && form.querySelector(EDITOR_SEL)) {
      captureAndSignal("button");
    }
  }, true);

  // Fallback: detect editor emptying (message was sent)
  let lastEditorLen = 0;
  setInterval(() => {
    for (const sel of [".ProseMirror", "#prompt-textarea", ".ql-editor"]) {
      const ed = document.querySelector(sel);
      if (!ed) continue;
      const text = (ed.textContent || "").trim();
      const len = text.length;
      if (lastEditorLen > 0 && len === 0) {
        captureAndSignal("editor empty");
      }
      lastEditorLen = len;
      if (len > 0) lastEditorText = text;
      break;
    }
  }, 500);
}

function classifyMessage(el: Element): "assistant" | "user" | null {
  if (!PLATFORM) return null;
  for (const s of ASSISTANT_MARKER[PLATFORM]) {
    if (el.matches?.(s) || el.querySelector?.(s)) return "assistant";
  }
  for (const s of USER_MARKER[PLATFORM]) {
    if (el.matches?.(s) || el.querySelector?.(s)) return "user";
  }
  return null;
}

const messageEstimates = new WeakMap<Element, MessageEstimate>();

function sendMessageEstimate(el: Element, role: string, isUpdate: boolean) {
  const next = estimateMessage(el);
  const prev = messageEstimates.get(el) || {
    totalTokens: 0, textTokens: 0, imageTokens: 0, fileTokens: 0, imageCount: 0, fileCount: 0,
  };
  const delta = {
    total: next.totalTokens - prev.totalTokens,
    text: next.textTokens - prev.textTokens,
    image: next.imageTokens - prev.imageTokens,
    file: next.fileTokens - prev.fileTokens,
    imageCount: next.imageCount - prev.imageCount,
    fileCount: next.fileCount - prev.fileCount,
  };
  messageEstimates.set(el, next);

  if (isUpdate && delta.total === 0 && delta.text === 0 && delta.image === 0 && delta.file === 0 && delta.imageCount === 0 && delta.fileCount === 0) {
    return;
  }

  const payload: TrackerMessage = {
    type: "insights-message",
    platform: PLATFORM,
    role,
    estimatedTokens: next.totalTokens,
    estimatedTextTokens: next.textTokens,
    estimatedImageTokens: next.imageTokens,
    estimatedFileTokens: next.fileTokens,
    imageCount: next.imageCount,
    fileCount: next.fileCount,
    estimateSource: "local",
    model: getCurrentModel(),
    timestamp: Date.now(),
  };

  if (isUpdate) {
    payload.isUpdate = true;
    payload.tokenDelta = delta.total;
    payload.textTokenDelta = delta.text;
    payload.imageTokenDelta = delta.image;
    payload.fileTokenDelta = delta.file;
    payload.imageCountDelta = delta.imageCount;
    payload.fileCountDelta = delta.fileCount;
  }

  if (!isUpdate) console.log("[Aleph] message counted:", role, "tokens:", next.totalTokens, "preview:", next.text.substring(0, 60));
  send(payload);
}

// Images change a message's estimate without any text change (naturalWidth
// arrives when the file loads; isContentImage reads it) — fingerprint the
// img population so settling images still trigger a recount.
function imgSettleState(el: Element): number {
  const imgs = el.querySelectorAll<HTMLImageElement>("img");
  let complete = 0;
  imgs.forEach((img) => { if (img.complete) complete++; });
  return imgs.length * 1000 + complete;
}

function scheduleSettledRecount(el: Element, role: string) {
  if (role !== "assistant") return;
  let lastText = el.textContent || "";
  let lastImgs = imgSettleState(el);
  let stableChecks = 0;
  let checks = 0;
  const check = () => {
    if (!document.contains(el)) return;
    // Skip the expensive estimate while neither the text nor the image
    // population changed since the previous tick.
    const currentText = el.textContent || "";
    const currentImgs = imgSettleState(el);
    if (checks === 0 || currentText !== lastText || currentImgs !== lastImgs) {
      sendMessageEstimate(el, role, true);
    }
    lastImgs = currentImgs;
    if (currentText === lastText) stableChecks++;
    else {
      stableChecks = 0;
      lastText = currentText;
    }
    checks++;
    if (stableChecks < 3 && checks < 20) setTimeout(check, 1500);
  };
  setTimeout(check, 1500);
}

function processNewMessage(el: Element) {
  if (countedMessages.has(el)) return;
  countedMessages.add(el);
  const role = classifyMessage(el);
  if (!role) return;
  sendMessageEstimate(el, role, false);
  scheduleSettledRecount(el, role);
}

export function markExistingMessages() {
  if (!PLATFORM) return;
  let count = 0;
  for (const sel of MSG_WRAPPER[PLATFORM]) {
    document.querySelectorAll(sel).forEach((el) => { countedMessages.add(el); count++; });
  }
  if (count > 0) console.log("[Aleph] marked", count, "existing msgs");
}

// Observe document.body (not a container that SPAs might replace)
export function startMessageObserver() {
  const platform = PLATFORM;
  if (!platform) return;
  new MutationObserver((mutations) => {
    const newMsgs: Element[] = [];
    for (const m of mutations) {
      if ((m.target as Element).id === "aleph-dynamic-styles") continue;
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        const added = node as Element;
        for (const sel of MSG_WRAPPER[platform]) {
          if (added.matches?.(sel)) { newMsgs.push(added); continue; }
          added.querySelectorAll?.(sel).forEach((el) => newMsgs.push(el));
        }
      }
    }
    if (newMsgs.length === 0) return;
    const inGrace = Date.now() < graceUntil;
    const recentSend = (Date.now() - getUserSentAt()) < 30000;
    if (!recentSend && (newMsgs.length > 2 || inGrace)) {
      console.log("[Aleph] skipped", newMsgs.length, "msgs (bulk=" + (newMsgs.length > 2) + " grace=" + inGrace + ")");
      newMsgs.forEach((el) => countedMessages.add(el));
    } else {
      newMsgs.forEach(processNewMessage);
    }
  }).observe(document.body, { childList: true, subtree: true });
}

// Re-mark existing messages on SPA navigation (URL change within same tab).
// Event-driven via the Navigation API (Baseline since early 2026); the 2s
// URL poll remains only as the fallback where the API is unavailable.
export function startNavRemark() {
  let lastUrl = location.href;
  const onNav = () => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    if ((Date.now() - getUserSentAt()) < 15000) {
      console.log("[Aleph] nav after send — skip marking");
    } else {
      graceUntil = Date.now() + 2000;
      markExistingMessages();
      setTimeout(markExistingMessages, 500);
      setTimeout(markExistingMessages, 1000);
      setTimeout(markExistingMessages, 2000);
      setTimeout(markExistingMessages, 3000);
    }
  };
  // Narrowing cast: the Navigation API isn't in our TS lib set.
  const nav = (window as unknown as { navigation?: EventTarget }).navigation;
  if (nav) {
    // navigatesuccess fires after the navigation commits (URL updated).
    nav.addEventListener("navigatesuccess", onNav);
  } else {
    setInterval(onNav, 2000);
  }
}
