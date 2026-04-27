(function () {
  "use strict";

  /* ======================================================================
   *  ALEPH v2.0 — Hebrew BiDi + Style Unifier for Claude / ChatGPT / Gemini
   * ====================================================================== */

  const HEB = /[֐-׿]/;
  const VERSION = "2.0";

  // ── Platform detection ─────────────────────────────────────────────────
  const host = location.hostname;
  const PLATFORM =
    host.includes("claude.ai") ? "claude" :
    host.includes("chatgpt.com") || host.includes("chat.openai.com") ? "chatgpt" :
    host.includes("gemini.google.com") ? "gemini" :
    null;

  if (!PLATFORM) return;

  document.documentElement.setAttribute("data-aleph-platform", PLATFORM);

  // ── Theme definitions ──────────────────────────────────────────────────
  const THEMES = {
    none: null,
    warmDark: {
      bg:          "#1c1917",
      bgSecondary: "#292524",
      bgTertiary:  "#1a1614",
      text:        "#e7e5e4",
      textMuted:   "#a8a29e",
      accent:      "#fb923c",
      border:      "#44403c",
      codeBg:      "#211e1b",
      codeBorder:  "#3a3632",
      inputBg:     "#252220",
    },
    coolDark: {
      bg:          "#0f172a",
      bgSecondary: "#1e293b",
      bgTertiary:  "#0c1322",
      text:        "#e2e8f0",
      textMuted:   "#94a3b8",
      accent:      "#38bdf8",
      border:      "#334155",
      codeBg:      "#0d1424",
      codeBorder:  "#2d3a4d",
      inputBg:     "#1a2438",
    },
    paperLight: {
      bg:          "#faf8f5",
      bgSecondary: "#f0ebe3",
      bgTertiary:  "#e8e2d8",
      text:        "#2c2418",
      textMuted:   "#78716c",
      accent:      "#c2410c",
      border:      "#d4cfc8",
      codeBg:      "#f3ede4",
      codeBorder:  "#d4cfc8",
      inputBg:     "#ffffff",
    },
    highContrast: {
      bg:          "#000000",
      bgSecondary: "#0a0a0a",
      bgTertiary:  "#000000",
      text:        "#ffffff",
      textMuted:   "#d4d4d4",
      accent:      "#fde047",
      border:      "#525252",
      codeBg:      "#0a0a0a",
      codeBorder:  "#525252",
      inputBg:     "#0a0a0a",
    },
    midnight: {
      bg:          "#13111c",
      bgSecondary: "#1e1b2e",
      bgTertiary:  "#0f0d17",
      text:        "#e4e0ee",
      textMuted:   "#9b95b0",
      accent:      "#a78bfa",
      border:      "#312d45",
      codeBg:      "#181523",
      codeBorder:  "#2b2740",
      inputBg:     "#1b1829",
    },
    nord: {
      bg:          "#2e3440",
      bgSecondary: "#3b4252",
      bgTertiary:  "#282e3a",
      text:        "#eceff4",
      textMuted:   "#d8dee9",
      accent:      "#88c0d0",
      border:      "#4c566a",
      codeBg:      "#2e3440",
      codeBorder:  "#434c5e",
      inputBg:     "#3b4252",
    },
    dracula: {
      bg:          "#282a36",
      bgSecondary: "#343746",
      bgTertiary:  "#21222c",
      text:        "#f8f8f2",
      textMuted:   "#bfbfbf",
      accent:      "#bd93f9",
      border:      "#44475a",
      codeBg:      "#282a36",
      codeBorder:  "#44475a",
      inputBg:     "#343746",
    },
    solarized: {
      bg:          "#002b36",
      bgSecondary: "#073642",
      bgTertiary:  "#00252f",
      text:        "#eee8d5",
      textMuted:   "#93a1a1",
      accent:      "#2aa198",
      border:      "#2f4f56",
      codeBg:      "#073642",
      codeBorder:  "#2f4f56",
      inputBg:     "#073642",
    },
    rosePine: {
      bg:          "#191724",
      bgSecondary: "#1f1d2e",
      bgTertiary:  "#15131f",
      text:        "#e0def4",
      textMuted:   "#908caa",
      accent:      "#ebbcba",
      border:      "#2a2740",
      codeBg:      "#1f1d2e",
      codeBorder:  "#2a2740",
      inputBg:     "#1f1d2e",
    },
    catppuccin: {
      bg:          "#1e1e2e",
      bgSecondary: "#28283d",
      bgTertiary:  "#181825",
      text:        "#cdd6f4",
      textMuted:   "#a6adc8",
      accent:      "#cba6f7",
      border:      "#363654",
      codeBg:      "#1e1e2e",
      codeBorder:  "#363654",
      inputBg:     "#28283d",
    },
  };

  // ── Platform-specific selectors ────────────────────────────────────────
  const SELECTORS = {
    claude: {
      text: [
        ".font-claude-response-body",
        ".standard-markdown p", ".standard-markdown li",
        ".standard-markdown h1", ".standard-markdown h2",
        ".standard-markdown h3", ".standard-markdown h4",
        ".standard-markdown blockquote",
        ".progressive-markdown p", ".progressive-markdown li",
        ".progressive-markdown h1", ".progressive-markdown h2",
        ".progressive-markdown h3", ".progressive-markdown h4",
        ".font-claude-response p", ".font-claude-response li",
        ".whitespace-pre-wrap"
      ],
      editor: [".ProseMirror"],
      math: [".katex", ".katex-display", ".katex-html", ".katex-mathml", "mjx-container"],
      code: [".code-block__code", "pre code", ".code-block"],
      message: [".font-claude-response", "[data-testid='chat-message-content']"],
      chatWidth: [".mx-auto.w-full"],
      // Theme targets
      themeBg: ["body", "main", ".bg-bg-000", ".bg-bg-100", ".bg-bg-200"],
      themeText: [".font-claude-response", ".font-claude-response-body", "p", "li", "h1", "h2", "h3", "h4"],
      themeInput: [".ProseMirror", "[data-testid='composer']", ".bg-bg-000"],
      themeCode: [".code-block", ".code-block__code", "pre"],
      themeSidebar: ["nav", ".bg-bg-100"],
      // Focus mode: elements to hide
      focusHide: [
        "[data-testid='nav-upgrade']",
        "[data-testid='upgrade-button']",
        ".bg-accent-main-000[class*='upgrade']",
        "[href='/settings/billing']",
      ],
      // Streaming containers
      streaming: [".progressive-markdown", ".font-claude-response"],
      // Message wrapper (for spacing)
      messageWrapper: ["[data-testid='chat-message']", ".mb-1\\.5"],
    },
    chatgpt: {
      text: [
        ".markdown p", ".markdown li",
        ".markdown h1", ".markdown h2", ".markdown h3", ".markdown h4",
        ".markdown blockquote",
        ".prose p", ".prose li",
        "[data-message-author-role='assistant'] p",
        "[data-message-author-role='assistant'] li"
      ],
      editor: ["#prompt-textarea", "[contenteditable='true']"],
      math: [".katex", ".katex-display", ".katex-html", ".katex-mathml", "mjx-container", ".math-inline", ".math-display"],
      code: ["code.hljs", "pre code", ".code-block__code"],
      message: [".markdown", "[data-message-author-role='assistant']"],
      chatWidth: ["main [class*='thread-content']", "main .max-w-3xl"],
      themeBg: ["body", "main", ".bg-token-main-surface-primary", ".bg-white", ".dark\\:bg-gray-800"],
      themeText: [".markdown", ".prose", "p", "li", "h1", "h2", "h3", "h4"],
      themeInput: ["#prompt-textarea", ".bg-token-main-surface-primary", "[contenteditable='true']"],
      themeCode: ["pre", "code.hljs", ".bg-black"],
      themeSidebar: ["nav", ".bg-token-sidebar-surface-primary"],
      focusHide: [
        "[data-testid='upgrade-button']",
        "a[href='/gpts']",
        "[class*='upgrade']",
        ".juice\\:hidden",
        "header .pointer-events-none:has(.rounded-full)",
      ],
      streaming: [".result-streaming", ".markdown"],
      messageWrapper: ["[data-testid^='conversation-turn']", ".group\\/conversation-turn"],
    },
    gemini: {
      text: [
        ".response-content p", ".response-content li",
        ".response-content h1", ".response-content h2",
        ".response-content h3", ".response-content h4",
        ".response-content blockquote",
        ".markdown p", ".markdown li",
        ".model-response-text p", ".model-response-text li",
        "message-content p", "message-content li"
      ],
      editor: [".ql-editor", "rich-textarea .ql-editor", "[contenteditable='true']"],
      math: [".katex", ".katex-display", ".katex-html", ".katex-mathml", "mjx-container"],
      code: ["code-block", "pre code", ".code-container"],
      message: [".response-content", ".model-response-text", "message-content"],
      chatWidth: [".conversation-container"],
      themeBg: ["body", "main", ".chat-container", "chat-app", "bard-sidenav-container", ".conversation-container"],
      themeText: [".response-content", ".model-response-text", "message-content", "p", "li", ".query-content"],
      themeInput: [".ql-editor", "rich-textarea", "[contenteditable='true']", ".text-input-field_textarea"],
      themeCode: ["code-block", "pre", ".code-container"],
      themeSidebar: ["nav", "side-navigation-v2", "side-navigation-content", ".side-navigation-content"],
      focusHide: [
        "intent-card",
        ".card-container",
        ".suggestion-chip",
        ".chip-container",
        "[class*='promo']",
        "[class*='upgrade']",
      ],
      streaming: [".response-content", ".model-response-text", "model-response"],
      messageWrapper: ["model-response", ".conversation-turn", ".conversation-container > *"],
    },
  };

  const SEL = SELECTORS[PLATFORM];

  // ── Default settings ───────────────────────────────────────────────────
  const DEFAULTS = {
    bidiEnabled: true,
    enableClaude: true,
    enableChatgpt: true,
    enableGemini: true,
    fontFamily: "",
    fontSize: 0,
    lineHeight: 0,
    paragraphSpacing: 0,
    codeFontSize: 0,
    codeFontFamily: "",
    chatWidth: 0,
    // v2: new features
    theme: "none",
    focusMode: false,
    streamSmooth: true,
    streamAnimation: "fadeIn",
    messageSpacing: 0,
  };

  let settings = { ...DEFAULTS };

  // ── Settings loader ────────────────────────────────────────────────────
  function loadSettings() {
    return new Promise((resolve) => {
      if (chrome?.storage?.sync) {
        chrome.storage.sync.get(DEFAULTS, (s) => {
          settings = { ...DEFAULTS, ...s };
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  if (chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "sync") {
        for (const [key, { newValue }] of Object.entries(changes)) {
          settings[key] = newValue;
        }
        applyStyles();
        patchAll();
      }
    });
  }

  function isPlatformEnabled() {
    const key = "enable" + PLATFORM.charAt(0).toUpperCase() + PLATFORM.slice(1);
    return settings[key] !== false;
  }

  // ── BiDi Detection ─────────────────────────────────────────────────────
  function hasHebrew(el) {
    if (!el) return false;
    for (const c of el.childNodes) {
      if (c.nodeType === 3 && HEB.test(c.textContent)) return true;
      if (c.nodeType === 1) {
        const tag = c.tagName?.toLowerCase();
        if (c.classList?.contains("katex") || tag === "mjx-container" ||
            tag === "code" || tag === "pre") continue;
        if (hasHebrew(c)) return true;
      }
    }
    return false;
  }

  // ── BiDi Patcher ───────────────────────────────────────────────────────
  let patching = false;

  function patchAll() {
    if (patching || !isPlatformEnabled()) return;
    patching = true;
    try {
      if (settings.bidiEnabled) patchBidi();
      if (settings.focusMode) applyFocusMode();
      if (settings.streamSmooth) {
        applyStreamSmooth();
        const anim = settings.streamAnimation || "fadeIn";
        if (document.documentElement.getAttribute("data-aleph-stream-anim") !== anim) {
          document.documentElement.setAttribute("data-aleph-stream-anim", anim);
        }
      }
    } finally {
      patching = false;
    }
  }

  function patchBidi() {
    const textSel = SEL.text.join(", ");
    document.querySelectorAll(textSel).forEach((el) => {
      if (el.closest(".katex") || el.closest("mjx-container")) return;
      const need = hasHebrew(el);
      const has = el.getAttribute("data-aleph-rtl");
      if (need && has !== "true") {
        el.setAttribute("data-aleph-rtl", "true");
      } else if (!need && has === "true") {
        el.removeAttribute("data-aleph-rtl");
      }
    });

    SEL.editor.forEach((sel) => {
      document.querySelectorAll(sel).forEach((ed) => {
        const heb = HEB.test(ed.textContent || "");
        const val = heb ? "true" : "false";
        if (ed.getAttribute("data-aleph-rtl") !== val) {
          ed.setAttribute("data-aleph-rtl", val);
        }
        if (!ed.__alephListener) {
          ed.addEventListener("input", () => {
            const h = HEB.test(ed.textContent || "");
            ed.setAttribute("data-aleph-rtl", h ? "true" : "false");
          });
          ed.__alephListener = true;
        }
      });
    });
  }

  // ── Focus Mode ─────────────────────────────────────────────────────────
  function applyFocusMode() {
    SEL.focusHide.forEach((sel) => {
      try {
        document.querySelectorAll(sel).forEach((el) => {
          if (!el.hasAttribute("data-aleph-hidden")) {
            el.setAttribute("data-aleph-hidden", "true");
          }
        });
      } catch (e) { /* selector may be invalid on some platforms */ }
    });

    // Text-based matching for upgrade buttons that lack stable selectors
    if (PLATFORM === "chatgpt") {
      document.querySelectorAll("button, a, [role='menuitem'], .trailing").forEach((el) => {
        const txt = el.textContent.trim();
        if (txt === "Upgrade" || txt === "Upgrade plan" || txt === "Get Plus") {
          const target = el.closest(".group, .trailing, header .pointer-events-none") || el;
          if (!target.hasAttribute("data-aleph-hidden")) {
            target.setAttribute("data-aleph-hidden", "true");
          }
        }
      });
    }
  }

  // ── Streaming Smoothing ────────────────────────────────────────────────
  function applyStreamSmooth() {
    SEL.streaming.forEach((sel) => {
      try {
        document.querySelectorAll(sel).forEach((el) => {
          if (!el.hasAttribute("data-aleph-stream")) {
            el.setAttribute("data-aleph-stream", "true");
          }
        });
      } catch (e) {}
    });
  }

  // ── Style Injector ─────────────────────────────────────────────────────
  const STYLE_ID = "aleph-dynamic-styles";

  function applyStyles() {
    if (!isPlatformEnabled()) {
      const existing = document.getElementById(STYLE_ID);
      if (existing) existing.remove();
      document.documentElement.removeAttribute("data-aleph-theme");
      document.documentElement.removeAttribute("data-aleph-focus");
      document.documentElement.removeAttribute("data-aleph-stream-enabled");
      return;
    }

    let css = "";

    // ── Theme ──────────────────────────────────────────────────────────
    const theme = THEMES[settings.theme];
    if (theme) {
      document.documentElement.setAttribute("data-aleph-theme", settings.theme);

      // Set CSS custom properties on root
      css += `:root[data-aleph-theme="${settings.theme}"] {
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

      // Background overrides
      const bgSel = SEL.themeBg.join(",\n");
      css += `[data-aleph-theme] ${bgSel.split(",").map(s => s.trim()).join(",\n[data-aleph-theme] ")} {
        background-color: var(--aleph-bg) !important;
      }\n`;

      // Secondary backgrounds (sidebar, cards)
      const sidebarSel = SEL.themeSidebar.join(",\n");
      css += `[data-aleph-theme] ${sidebarSel.split(",").map(s => s.trim()).join(",\n[data-aleph-theme] ")} {
        background-color: var(--aleph-bg2) !important;
        border-color: var(--aleph-border) !important;
      }\n`;

      // Text overrides
      css += `[data-aleph-theme] { color: var(--aleph-text) !important; }\n`;
      const textSel = SEL.themeText.join(",\n");
      css += `[data-aleph-theme] ${textSel.split(",").map(s => s.trim()).join(",\n[data-aleph-theme] ")} {
        color: var(--aleph-text) !important;
      }\n`;

      // Input overrides
      const inputSel = SEL.themeInput.join(",\n");
      css += `[data-aleph-theme] ${inputSel.split(",").map(s => s.trim()).join(",\n[data-aleph-theme] ")} {
        background-color: var(--aleph-input-bg) !important;
        color: var(--aleph-text) !important;
        border-color: var(--aleph-border) !important;
      }\n`;

      // Code block overrides
      const codeSel = SEL.themeCode.join(",\n");
      css += `[data-aleph-theme] ${codeSel.split(",").map(s => s.trim()).join(",\n[data-aleph-theme] ")} {
        background-color: var(--aleph-code-bg) !important;
        border-color: var(--aleph-code-border) !important;
        color: var(--aleph-text) !important;
      }\n`;

      // Accent color for links and highlights
      css += `[data-aleph-theme] a { color: var(--aleph-accent) !important; }\n`;

      // Border overrides
      css += `[data-aleph-theme] * {
        border-color: var(--aleph-border);
      }\n`;

      // Scrollbar theming
      css += `[data-aleph-theme] ::-webkit-scrollbar { width: 8px; }
      [data-aleph-theme] ::-webkit-scrollbar-track { background: var(--aleph-bg); }
      [data-aleph-theme] ::-webkit-scrollbar-thumb { background: var(--aleph-border); border-radius: 4px; }\n`;

    } else {
      document.documentElement.removeAttribute("data-aleph-theme");
    }

    // ── Focus Mode ───────────────────────────────────────────────────────
    if (settings.focusMode) {
      document.documentElement.setAttribute("data-aleph-focus", "true");
      css += `[data-aleph-hidden] { display: none !important; }\n`;
    } else {
      document.documentElement.removeAttribute("data-aleph-focus");
      // Remove hidden markers
      document.querySelectorAll("[data-aleph-hidden]").forEach(el => {
        el.removeAttribute("data-aleph-hidden");
      });
    }

    // ── Streaming Smoothing ──────────────────────────────────────────────
    if (settings.streamSmooth) {
      document.documentElement.setAttribute("data-aleph-stream-enabled", "true");
      document.documentElement.setAttribute("data-aleph-stream-anim", settings.streamAnimation || "fadeIn");
    } else {
      document.documentElement.removeAttribute("data-aleph-stream-enabled");
      document.documentElement.removeAttribute("data-aleph-stream-anim");
    }

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

  // ── Observer ───────────────────────────────────────────────────────────
  let timer = null;
  function scheduleUpdate() {
    if (patching) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(patchAll, 120);
  }

  new MutationObserver(scheduleUpdate).observe(document.body, {
    childList: true, subtree: true, characterData: true,
  });

  // ── Boot ───────────────────────────────────────────────────────────────
  loadSettings().then(() => {
    applyStyles();
    patchAll();
    setTimeout(patchAll, 1500);
    setInterval(patchAll, 3000);
  });

  console.log(
    `%c[Aleph v${VERSION}] ✓ Loaded on ${PLATFORM}`,
    "color:#4ade80;font-weight:bold;font-size:14px"
  );
})();
