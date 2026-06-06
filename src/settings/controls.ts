import { DEFAULTS } from "../shared/defaults";
import { THEME_NAMES } from "../shared/themes";

const CHECKBOXES = [
  "bidiEnabled", "enableClaude", "enableChatgpt", "enableGemini",
  "focusHideUpgrade", "focusHideChips", "focusHidePromos",
  "latexFix", "streamSmooth",
];

const SELECTS = [
  "codeFontFamily", "streamAnimation",
  "themeClaude", "themeChatgpt", "themeGemini",
];

interface RangeControl {
  id: string;
  outputId: string;
  fmt: (v: number) => string;
}

const RANGES: RangeControl[] = [
  { id: "lineHeight",       outputId: "lineHeightVal",       fmt: (v) => v == 0 ? "default" : v.toFixed(1) },
  { id: "paragraphSpacing", outputId: "paragraphSpacingVal", fmt: (v) => v == 0 ? "default" : `${v}px` },
  { id: "codeFontSize",     outputId: "codeFontSizeVal",     fmt: (v) => v == 0 ? "default" : `${v}px` },
  { id: "chatWidth",        outputId: "chatWidthVal",        fmt: (v) => v == 0 ? "default" : `${v}px` },
  { id: "messageSpacing",   outputId: "messageSpacingVal",   fmt: (v) => v == 0 ? "default" : `${v}px` },
];

function save(key: string, value: unknown) {
  chrome.storage.sync.set({ [key]: value });
}

// ── Populate per-platform theme dropdowns ──────────────────────────
function populateThemeSelects() {
  ["themeClaude", "themeChatgpt", "themeGemini"].forEach((id) => {
    const sel = document.getElementById(id) as HTMLSelectElement | null;
    if (!sel || sel.options.length > 1) return;
    Object.entries(THEME_NAMES).forEach(([key, name]) => {
      if (key === "none") return;
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = name;
      sel.appendChild(opt);
    });
  });
}

function updateStreamAnimVisibility(streamEnabled: boolean) {
  const field = document.getElementById("streamAnimField");
  if (field) field.style.display = streamEnabled ? "" : "none";
}

// ── Load settings into UI ──────────────────────────────────────────
export function loadUI() {
  populateThemeSelects();
  chrome.storage.sync.get(DEFAULTS, (s) => {
    CHECKBOXES.forEach((id) => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (el) el.checked = s[id];
    });
    SELECTS.forEach((id) => {
      const el = document.getElementById(id) as HTMLSelectElement | null;
      if (el) el.value = s[id];
    });
    RANGES.forEach(({ id, outputId, fmt }) => {
      const input = document.getElementById(id) as HTMLInputElement | null;
      const output = document.getElementById(outputId);
      if (input && output) {
        input.value = s[id];
        output.textContent = fmt(parseFloat(s[id]));
      }
    });
    updateStreamAnimVisibility(s.streamSmooth);
  });
}

// ── Bind events ────────────────────────────────────────────────────
export function bindEvents() {
  CHECKBOXES.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      save(id, checked);
      if (id === "streamSmooth") updateStreamAnimVisibility(checked);
    });
  });

  SELECTS.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", (e) => {
      save(id, (e.target as HTMLSelectElement).value);
    });
  });

  RANGES.forEach(({ id, outputId, fmt }) => {
    const input = document.getElementById(id) as HTMLInputElement | null;
    const output = document.getElementById(outputId);
    if (!input || !output) return;
    input.addEventListener("input", () => {
      output.textContent = fmt(parseFloat(input.value));
    });
    input.addEventListener("change", () => {
      save(id, parseFloat(input.value));
    });
  });

  document.getElementById("resetBtn")!.addEventListener("click", () => {
    chrome.storage.sync.set(DEFAULTS, () => loadUI());
  });

  document.getElementById("backLink")!.addEventListener("click", (e) => {
    e.preventDefault();
    window.close();
  });
}
