import { THEMES } from "../shared/themes";
import { updateBidiRootAttribute } from "./bidi";
import { loadFont } from "./fonts";
import { SEL } from "./selectors";
import { getSettings, isPlatformEnabled } from "./settingsStore";
import { getActiveThemeName, updateColorScheme } from "./theme";

// ── Style Injector ─────────────────────────────────────────────────────
export const STYLE_ID = "aleph-dynamic-styles";

export function buildThemeSelector(_base: string, selectors: string[]): string {
  return selectors.map(s => `[data-aleph-theme] ${s.trim()}`).join(",\n");
}

export function applyStyles() {
  const settings = getSettings();
  if (!isPlatformEnabled()) {
    const existing = document.getElementById(STYLE_ID);
    if (existing) existing.remove();
    document.documentElement.removeAttribute("data-aleph-bidi-enabled");
    document.documentElement.removeAttribute("data-aleph-theme");
    document.documentElement.removeAttribute("data-aleph-focus");
    document.documentElement.removeAttribute("data-aleph-stream-enabled");
    document.documentElement.removeAttribute("data-aleph-stream-anim");
    updateColorScheme(null);
    return;
  }

  updateBidiRootAttribute();

  let css = "";

  // ── Theme (per-platform override) ─────────────────────────────────
  const activeThemeName = getActiveThemeName();
  const theme = THEMES[activeThemeName];
  if (theme) {
    document.documentElement.setAttribute("data-aleph-theme", activeThemeName);
    updateColorScheme(theme);

    css += `:root[data-aleph-theme="${activeThemeName}"] {
      --aleph-bg: ${theme.bg};
      --aleph-bg2: ${theme.bgSecondary};
      --aleph-bg3: ${theme.bgTertiary};
      --aleph-text: ${theme.text};
      --aleph-text-muted: ${theme.textMuted};
      --aleph-accent: ${theme.accent};
      --aleph-border: ${theme.border};
      --aleph-code-bg: ${theme.codeBg};
      --aleph-code-border: ${theme.codeBorder};
      --aleph-input-bg: ${theme.inputBg};
    }\n`;

    css += `${buildThemeSelector("", SEL.themeBg)} {
      background-color: var(--aleph-bg) !important;
    }\n`;

    css += `${buildThemeSelector("", SEL.themeSidebar)} {
      background-color: var(--aleph-bg2) !important;
      border-color: var(--aleph-border) !important;
    }\n`;

    css += `${buildThemeSelector("", SEL.themeText)} {
      color: var(--aleph-text) !important;
    }\n`;

    css += `${buildThemeSelector("", SEL.themeInput)} {
      background-color: var(--aleph-input-bg) !important;
      color: var(--aleph-text) !important;
      border-color: var(--aleph-border) !important;
    }\n`;

    css += `${buildThemeSelector("", SEL.themeCode)} {
      background-color: var(--aleph-code-bg) !important;
      border-color: var(--aleph-code-border) !important;
      color: var(--aleph-text) !important;
    }\n`;

    const msgLinkSel = SEL.message.map(s => `[data-aleph-theme] ${s.trim()} a`).join(",\n");
    css += `${msgLinkSel} { color: var(--aleph-accent) !important; }\n`;
    css += `[data-aleph-theme] ::-webkit-scrollbar { width: 8px; }
    [data-aleph-theme] ::-webkit-scrollbar-track { background: var(--aleph-bg); }
    [data-aleph-theme] ::-webkit-scrollbar-thumb { background: var(--aleph-border); border-radius: 4px; }\n`;

  } else {
    document.documentElement.removeAttribute("data-aleph-theme");
    updateColorScheme(null);
  }

  // ── Focus Mode ───────────────────────────────────────────────────────
  if (settings.focusMode) {
    document.documentElement.setAttribute("data-aleph-focus", "true");
    css += `[data-aleph-hidden] { display: none !important; }\n`;
  } else {
    document.documentElement.removeAttribute("data-aleph-focus");
    document.querySelectorAll("[data-aleph-hidden]").forEach(el => {
      el.removeAttribute("data-aleph-hidden");
    });
  }

  // ── Streaming Smoothing ──────────────────────────────────────────────
  if (settings.streamSmooth) {
    document.documentElement.setAttribute("data-aleph-stream-enabled", "true");
    document.documentElement.setAttribute("data-aleph-stream-anim", settings.streamAnimation || "platform");
  } else {
    document.documentElement.removeAttribute("data-aleph-stream-enabled");
    document.documentElement.removeAttribute("data-aleph-stream-anim");
  }

  // ── Font loading ─────────────────────────────────────────────────────
  if (settings.fontFamily) loadFont(settings.fontFamily);
  if (settings.codeFontFamily) loadFont(settings.codeFontFamily);

  // ── Typography overrides ─────────────────────────────────────────────
  const textSelectors = SEL.text.concat(SEL.message).join(",\n");

  if (settings.fontFamily) {
    css += `${textSelectors} { font-family: "${settings.fontFamily}", "Segoe UI", Tahoma, sans-serif !important; }\n`;
  }
  if (settings.fontSize > 0) {
    css += `${textSelectors} { font-size: ${settings.fontSize}px !important; }\n`;
  }
  if (settings.lineHeight > 0) {
    css += `${textSelectors} { line-height: ${settings.lineHeight} !important; }\n`;
  } else if (settings.fontFamily === "Noto Nastaliq Urdu") {
    css += `${textSelectors} { line-height: 2 !important; }\n`;
  }
  if (settings.paragraphSpacing > 0) {
    const pSel = SEL.text.filter(s => s.endsWith(" p") || s === ".whitespace-pre-wrap").join(",\n");
    if (pSel) css += `${pSel} { margin-bottom: ${settings.paragraphSpacing}px !important; }\n`;
  }

  // ── Code block overrides ─────────────────────────────────────────────
  const codeSelectors = SEL.code.join(",\n");
  if (settings.codeFontFamily) {
    css += `${codeSelectors} { font-family: "${settings.codeFontFamily}", "Fira Code", "Consolas", monospace !important; }\n`;
  }
  if (settings.codeFontSize > 0) {
    css += `${codeSelectors} { font-size: ${settings.codeFontSize}px !important; }\n`;
  }

  // ── Chat width override ──────────────────────────────────────────────
  if (settings.chatWidth > 0) {
    const widthSel = SEL.chatWidth.join(",\n");
    css += `${widthSel} { max-width: ${settings.chatWidth}px !important; width: 100% !important; }\n`;
  }

  // ── Message spacing ──────────────────────────────────────────────────
  if (settings.messageSpacing > 0 && SEL.messageWrapper) {
    const msgSel = SEL.messageWrapper.join(",\n");
    css += `${msgSel} { margin-bottom: ${settings.messageSpacing}px !important; }\n`;
  }

  // Inject
  let styleEl = document.getElementById(STYLE_ID);
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = STYLE_ID;
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = css;
}
