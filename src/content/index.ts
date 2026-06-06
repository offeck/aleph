import { VERSION } from "../shared/version";
import { updateBadge } from "./badge";
import { cleanupEditorDir, patchBidi, updateBidiRootAttribute } from "./bidi";
import { applyFocusMode } from "./focus";
import { patchLatex, patchMathText } from "./latex";
import { PLATFORM } from "./platform";
import { applySettingsChange, getSettings, isPlatformEnabled, loadSettings } from "./settingsStore";
import { applyStreamSmooth } from "./streaming";
import { applyStyles, STYLE_ID } from "./styles";

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

function patchAll() {
  ensureRootAttributes();
  updateBidiRootAttribute();
  if (patching || !isPlatformEnabled()) return;
  patching = true;
  try {
    const settings = getSettings();
    if (settings.bidiEnabled) patchBidi();
    else cleanupEditorDir();
    if (settings.focusMode) applyFocusMode();
    if (settings.latexFix) patchLatex();
    if (settings.bidiEnabled) patchMathText();
    if (settings.streamSmooth) {
      applyStreamSmooth();
      const anim = settings.streamAnimation || "platform";
      if (document.documentElement.getAttribute("data-aleph-stream-anim") !== anim) {
        document.documentElement.setAttribute("data-aleph-stream-anim", anim);
      }
    }
  } finally {
    patching = false;
  }
}

// ── Observer (scoped to relevant mutations) ────────────────────────────
let timer: ReturnType<typeof setTimeout> | null = null;
function scheduleUpdate() {
  if (patching) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(patchAll, 120);
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
    for (const m of mutations) {
      const target = m.target as Element;
      if (target === document.head || target.closest?.("head")) continue;
      if (target.id === STYLE_ID) continue;
      scheduleUpdate();
      return;
    }
  }).observe(document.body, {
    childList: true, subtree: true, characterData: true,
  });

  // ── Boot ───────────────────────────────────────────────────────────────
  loadSettings().then(() => {
    applyStyles();
    patchAll();
    updateBadge();
    setTimeout(() => { applyStyles(); patchAll(); }, 1500);
    let patchIntervalId = setInterval(patchAll, 3000);

    new MutationObserver(() => {
      clearInterval(patchIntervalId);
      patchIntervalId = setInterval(patchAll, 500);
      setTimeout(() => {
        clearInterval(patchIntervalId);
        patchIntervalId = setInterval(patchAll, 3000);
      }, 30000);
    }).observe(document.documentElement, {
      attributes: true, attributeFilter: ["data-aleph-thinking"],
    });
  });

  console.log(
    `%c[Aleph v${VERSION}] loaded on ${PLATFORM} (build ${__ALEPH_BUILD__})`,
    "color:#4ade80;font-weight:bold;font-size:14px"
  );
}
