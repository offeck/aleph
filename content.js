(function () {
  "use strict";

  const HEB = /[֐-׿]/;
  const VERSION = "2.5.0";

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
      bg: "#1c1917", bgSecondary: "#292524", bgTertiary: "#1a1614",
      text: "#e7e5e4", textMuted: "#a8a29e", accent: "#fb923c",
      border: "#44403c", codeBg: "#211e1b", codeBorder: "#3a3632", inputBg: "#252220",
    },
    coolDark: {
      bg: "#0f172a", bgSecondary: "#1e293b", bgTertiary: "#0c1322",
      text: "#e2e8f0", textMuted: "#94a3b8", accent: "#38bdf8",
      border: "#334155", codeBg: "#0d1424", codeBorder: "#2d3a4d", inputBg: "#1a2438",
    },
    paperLight: {
      bg: "#faf8f5", bgSecondary: "#f0ebe3", bgTertiary: "#e8e2d8",
      text: "#2c2418", textMuted: "#78716c", accent: "#c2410c",
      border: "#d4cfc8", codeBg: "#f3ede4", codeBorder: "#d4cfc8", inputBg: "#ffffff",
    },
    highContrast: {
      bg: "#000000", bgSecondary: "#0a0a0a", bgTertiary: "#000000",
      text: "#ffffff", textMuted: "#d4d4d4", accent: "#fde047",
      border: "#525252", codeBg: "#0a0a0a", codeBorder: "#525252", inputBg: "#0a0a0a",
    },
    midnight: {
      bg: "#13111c", bgSecondary: "#1e1b2e", bgTertiary: "#0f0d17",
      text: "#e4e0ee", textMuted: "#9b95b0", accent: "#a78bfa",
      border: "#312d45", codeBg: "#181523", codeBorder: "#2b2740", inputBg: "#1b1829",
    },
    nord: {
      bg: "#2e3440", bgSecondary: "#3b4252", bgTertiary: "#282e3a",
      text: "#eceff4", textMuted: "#d8dee9", accent: "#88c0d0",
      border: "#4c566a", codeBg: "#2e3440", codeBorder: "#434c5e", inputBg: "#3b4252",
    },
    dracula: {
      bg: "#282a36", bgSecondary: "#343746", bgTertiary: "#21222c",
      text: "#f8f8f2", textMuted: "#bfbfbf", accent: "#bd93f9",
      border: "#44475a", codeBg: "#282a36", codeBorder: "#44475a", inputBg: "#343746",
    },
    solarized: {
      bg: "#002b36", bgSecondary: "#073642", bgTertiary: "#00252f",
      text: "#eee8d5", textMuted: "#93a1a1", accent: "#2aa198",
      border: "#2f4f56", codeBg: "#073642", codeBorder: "#2f4f56", inputBg: "#073642",
    },
    rosePine: {
      bg: "#191724", bgSecondary: "#1f1d2e", bgTertiary: "#15131f",
      text: "#e0def4", textMuted: "#908caa", accent: "#ebbcba",
      border: "#2a2740", codeBg: "#1f1d2e", codeBorder: "#2a2740", inputBg: "#1f1d2e",
    },
    catppuccin: {
      bg: "#1e1e2e", bgSecondary: "#28283d", bgTertiary: "#181825",
      text: "#cdd6f4", textMuted: "#a6adc8", accent: "#cba6f7",
      border: "#363654", codeBg: "#1e1e2e", codeBorder: "#363654", inputBg: "#28283d",
    },
    gruvbox: {
      bg: "#282828", bgSecondary: "#3c3836", bgTertiary: "#1d2021",
      text: "#ebdbb2", textMuted: "#a89984", accent: "#fe8019",
      border: "#504945", codeBg: "#1d2021", codeBorder: "#504945", inputBg: "#32302f",
    },
    oneDark: {
      bg: "#282c34", bgSecondary: "#2c313a", bgTertiary: "#21252b",
      text: "#abb2bf", textMuted: "#7f848e", accent: "#61afef",
      border: "#3e4451", codeBg: "#21252b", codeBorder: "#3e4451", inputBg: "#2c313a",
    },
    tokyoNight: {
      bg: "#1a1b26", bgSecondary: "#24283b", bgTertiary: "#16161e",
      text: "#c0caf5", textMuted: "#565f89", accent: "#7aa2f7",
      border: "#3b4261", codeBg: "#16161e", codeBorder: "#3b4261", inputBg: "#24283b",
    },
    githubDark: {
      bg: "#0d1117", bgSecondary: "#161b22", bgTertiary: "#010409",
      text: "#c9d1d9", textMuted: "#8b949e", accent: "#58a6ff",
      border: "#30363d", codeBg: "#161b22", codeBorder: "#30363d", inputBg: "#161b22",
    },
  };

  // ── Google Fonts map ───────────────────────────────────────────────────
  const GOOGLE_FONTS = {
    "Rubik": "Rubik:wght@400;500;700",
    "Heebo": "Heebo:wght@400;500;700",
    "Assistant": "Assistant:wght@400;600;700",
    "Noto Sans Hebrew": "Noto+Sans+Hebrew:wght@400;500;700",
    "Open Sans": "Open+Sans:wght@400;600;700",
    "Inter": "Inter:wght@400;500;700",
    "IBM Plex Sans": "IBM+Plex+Sans:wght@400;500;700",
    "Fira Code": "Fira+Code:wght@400;500;700",
    "JetBrains Mono": "JetBrains+Mono:wght@400;500;700",
    "Source Code Pro": "Source+Code+Pro:wght@400;500;700",
    "IBM Plex Mono": "IBM+Plex+Mono:wght@400;500;700",
  };

  function loadFont(fontName) {
    if (!fontName || !GOOGLE_FONTS[fontName]) return;
    const id = "aleph-font-" + fontName.replace(/\s+/g, "-").toLowerCase();
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=" + GOOGLE_FONTS[fontName] + "&display=swap";
    document.head.appendChild(link);
  }

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
      themeBg: ["body", "main", ".bg-bg-000", ".bg-bg-100", ".bg-bg-200"],
      themeText: [".font-claude-response", ".font-claude-response-body", "p", "li", "h1", "h2", "h3", "h4"],
      themeInput: [".ProseMirror", "[data-testid='composer']", ".bg-bg-000"],
      themeCode: [".code-block", ".code-block__code", "pre"],
      themeSidebar: ["nav", ".bg-bg-100"],
      focusHide: {
        upgrade: [
          "[data-testid='nav-upgrade']",
          "[data-testid='upgrade-button']",
          ".bg-accent-main-000[class*='upgrade']",
          "[href='/settings/billing']",
        ],
        chips: [],
        promos: [],
      },
      streaming: [".progressive-markdown", ".font-claude-response"],
      messageWrapper: ["[data-testid='chat-message']", ".mb-1\\.5"],
      chatContainer: ["main", "[data-testid='chat-messages']"],
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
      chatWidth: ["main .group\\/thread", "main [class*='thread-content']", "main .max-w-3xl"],
      themeBg: ["body", "main", ".bg-token-bg-primary", ".bg-token-main-surface-primary", ".bg-token-bg-tertiary"],
      themeText: [".markdown", ".prose", "p", "li", "h1", "h2", "h3", "h4"],
      themeInput: ["#prompt-textarea", ".bg-token-bg-primary", "[contenteditable='true']"],
      themeCode: ["pre", "code.hljs", ".bg-token-bg-tertiary"],
      themeSidebar: ["nav", "[class*='sidebar'][class*='shrink']", ".bg-\\(--sidebar-surface-primary\\)"],
      focusHide: {
        upgrade: [
          "[data-testid='upgrade-button']",
          "[class*='upgrade']",
        ],
        chips: [],
        promos: [
          "a[href='/gpts']",
          ".juice\\:hidden",
          "header .pointer-events-none:has(.rounded-full)",
        ],
      },
      streaming: [".result-streaming", ".markdown"],
      messageWrapper: ["[data-testid^='conversation-turn']", ".group\\/conversation-turn"],
      chatContainer: ["main", ".group\\/thread", "[class*='thread-content']"],
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
      themeBg: ["body", "main", ".chat-container", "chat-app", ".conversation-container", ".response-container"],
      themeText: [".response-content", ".model-response-text", "message-content", "p", "li", ".query-content", ".conversation-title"],
      themeInput: [".ql-editor", "rich-textarea", "[contenteditable='true']", ".text-input-field_textarea", "input-area-v2"],
      themeCode: ["code-block", "pre", ".code-container"],
      themeSidebar: ["nav", "side-navigation-v2", "side-navigation-content", ".side-navigation-content", "bard-sidenav", "bard-sidenav-container"],
      focusHide: {
        upgrade: ["[class*='upgrade']"],
        chips: ["intent-card", ".card-container", ".suggestion-chip", ".chip-container"],
        promos: ["[class*='promo']"],
      },
      streaming: [".response-content", ".model-response-text", "model-response"],
      messageWrapper: ["model-response", ".conversation-turn", ".conversation-container > *"],
      chatContainer: [".conversation-container", "chat-app"],
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
    theme: "none",
    themeClaude: "",
    themeChatgpt: "",
    themeGemini: "",
    focusMode: false,
    focusHideUpgrade: true,
    focusHideChips: true,
    focusHidePromos: true,
    latexFix: true,
    streamSmooth: true,
    streamAnimation: "platform",
    messageSpacing: 0,
  };

  let settings = { ...DEFAULTS };

  // ── Helpers ────────────────────────────────────────────────────────────
  function isPlatformEnabled() {
    const key = "enable" + PLATFORM.charAt(0).toUpperCase() + PLATFORM.slice(1);
    return settings[key] !== false;
  }

  function getActiveThemeName() {
    const platformKey = "theme" + PLATFORM.charAt(0).toUpperCase() + PLATFORM.slice(1);
    return settings[platformKey] || settings.theme || "none";
  }

  function isLightTheme(theme) {
    if (!theme) return null;
    const r = parseInt(theme.bg.slice(1, 3), 16);
    const g = parseInt(theme.bg.slice(3, 5), 16);
    const b = parseInt(theme.bg.slice(5, 7), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 128;
  }

  function updateColorScheme(theme) {
    const scheme = theme ? (isLightTheme(theme) ? "light" : "dark") : null;
    let meta = document.querySelector('meta[name="color-scheme"][data-aleph]');
    if (scheme) {
      if (!meta) {
        meta = document.createElement("meta");
        meta.name = "color-scheme";
        meta.setAttribute("data-aleph", "true");
        document.head.appendChild(meta);
      }
      meta.content = scheme;
      document.documentElement.style.colorScheme = scheme;
    } else if (meta) {
      meta.remove();
      document.documentElement.style.removeProperty("color-scheme");
    }
  }

  function updateBadge() {
    if (!chrome?.runtime?.sendMessage) return;
    if (!isPlatformEnabled()) {
      try { chrome.runtime.sendMessage({ type: "disabled" }); } catch (e) {}
      return;
    }
    let count = 0;
    if (settings.bidiEnabled) count++;
    const themeName = getActiveThemeName();
    if (themeName !== "none") count++;
    if (settings.focusMode) count++;
    if (settings.streamSmooth) count++;
    if (settings.fontFamily || settings.codeFontFamily) count++;
    if (settings.chatWidth > 0) count++;
    if (settings.latexFix) count++;
    try { chrome.runtime.sendMessage({ type: "badge", count }); } catch (e) {}
  }

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
        updateBadge();
      }
    });
  }

  // ── Toggle handler (keyboard shortcut) ─────────────────────────────────
  if (chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === "toggle") {
        const key = "enable" + PLATFORM.charAt(0).toUpperCase() + PLATFORM.slice(1);
        const newVal = !isPlatformEnabled();
        if (chrome?.storage?.sync) {
          chrome.storage.sync.set({ [key]: newVal });
        }
      }
    });
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

  // ── Markdown Fixer ──────────────────────────────────────────────────────
  const MD_RE = /\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*([^*\s][^*]*?[^*\s])\*|\*([^*\s])\*/g;

  function patchMarkdown() {
    const messageSel = SEL.message.join(", ");
    document.querySelectorAll(messageSel).forEach((msg) => {
      const walker = document.createTreeWalker(msg, NodeFilter.SHOW_TEXT);
      const nodes = [];
      let node;
      while ((node = walker.nextNode())) {
        const el = node.parentElement;
        if (!el) continue;
        if (el.closest("code, pre, style, script, .katex, .katex-display, mjx-container, [data-aleph-md-fixed]")) continue;
        if (el.tagName === "STRONG" || el.tagName === "EM" || el.tagName === "STYLE" || el.tagName === "SCRIPT") continue;
        const txt = node.textContent;
        if (txt && /\*{1,3}[^*]+\*{1,3}/.test(txt)) {
          nodes.push(node);
        }
      }
      nodes.forEach(fixMarkdownInNode);
    });
  }

  function fixMarkdownInNode(textNode) {
    const text = textNode.textContent;
    if (!text) return;
    MD_RE.lastIndex = 0;
    let match;
    const regions = [];
    while ((match = MD_RE.exec(text)) !== null) {
      if (match[1] !== undefined) {
        regions.push({ start: match.index, end: match.index + match[0].length, content: match[1], type: "bolditalic" });
      } else if (match[2] !== undefined) {
        regions.push({ start: match.index, end: match.index + match[0].length, content: match[2], type: "bold" });
      } else {
        const content = match[3] !== undefined ? match[3] : match[4];
        regions.push({ start: match.index, end: match.index + match[0].length, content, type: "italic" });
      }
    }
    if (regions.length === 0) return;

    const wrapper = document.createElement("span");
    wrapper.setAttribute("data-aleph-md-fixed", "true");
    let lastEnd = 0;
    for (const r of regions) {
      if (r.start > lastEnd) {
        wrapper.appendChild(document.createTextNode(text.slice(lastEnd, r.start)));
      }
      if (r.type === "bolditalic") {
        const strong = document.createElement("strong");
        const em = document.createElement("em");
        em.textContent = r.content;
        strong.appendChild(em);
        wrapper.appendChild(strong);
      } else if (r.type === "bold") {
        const strong = document.createElement("strong");
        strong.textContent = r.content;
        wrapper.appendChild(strong);
      } else {
        const em = document.createElement("em");
        em.textContent = r.content;
        wrapper.appendChild(em);
      }
      lastEnd = r.end;
    }
    if (lastEnd < text.length) {
      wrapper.appendChild(document.createTextNode(text.slice(lastEnd)));
    }
    textNode.parentNode.replaceChild(wrapper, textNode);
  }

  // ── BiDi Patcher ───────────────────────────────────────────────────────
  let patching = false;

  function patchAll() {
    if (patching || !isPlatformEnabled()) return;
    patching = true;
    try {
      if (settings.bidiEnabled) patchBidi();
      else cleanupEditorDir();
      if (settings.focusMode) applyFocusMode();
      if (settings.latexFix) patchLatex();
      patchMarkdown();
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
        ed.querySelectorAll("p, div, li").forEach((child) => {
          const hasText = child.textContent.trim().length > 0;
          if (hasText && child.getAttribute("dir") !== "auto") {
            child.setAttribute("dir", "auto");
          } else if (!hasText && child.getAttribute("dir") === "auto") {
            child.removeAttribute("dir");
          }
        });
        if (!ed.__alephListener) {
          ed.addEventListener("input", () => {
            ed.querySelectorAll("p, div, li").forEach((child) => {
              const hasText = child.textContent.trim().length > 0;
              if (hasText && child.getAttribute("dir") !== "auto") {
                child.setAttribute("dir", "auto");
              } else if (!hasText && child.getAttribute("dir") === "auto") {
                child.removeAttribute("dir");
              }
            });
          });
          ed.__alephListener = true;
        }
      });
    });
  }

  function cleanupEditorDir() {
    SEL.editor.forEach((sel) => {
      document.querySelectorAll(sel).forEach((ed) => {
        ed.querySelectorAll("p, div, li").forEach((child) => {
          if (child.getAttribute("dir") === "auto") child.removeAttribute("dir");
        });
      });
    });
  }

  // ── Focus Mode ─────────────────────────────────────────────────────────
  function applyFocusMode() {
    const cats = SEL.focusHide;
    const selectors = [];
    if (settings.focusHideUpgrade && cats.upgrade) selectors.push(...cats.upgrade);
    if (settings.focusHideChips && cats.chips) selectors.push(...cats.chips);
    if (settings.focusHidePromos && cats.promos) selectors.push(...cats.promos);

    selectors.forEach((sel) => {
      try {
        document.querySelectorAll(sel).forEach((el) => {
          if (!el.hasAttribute("data-aleph-hidden")) {
            el.setAttribute("data-aleph-hidden", "true");
          }
        });
      } catch (e) {}
    });

    if (PLATFORM === "chatgpt" && settings.focusHideUpgrade) {
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

  // ── LaTeX Fixer ────────────────────────────────────────────────────────
  const LATEX_CMD_RE = /\\(?:frac|int|iint|iiint|oint|sum|prod|coprod|sqrt|leq|geq|neq|cdot|cdots|ldots|ddots|vdots|times|div|pm|mp|circ|ast|star|dagger|ddagger|amalg|cap|cup|uplus|sqcap|sqcup|vee|wedge|oplus|ominus|otimes|oslash|odot|bigcup|bigcap|bigvee|bigwedge|bigoplus|bigotimes|alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|pi|varpi|rho|varrho|sigma|varsigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega|infty|partial|nabla|forall|exists|nexists|neg|lnot|approx|equiv|sim|simeq|cong|propto|subset|supset|subseteq|supseteq|subsetneq|supsetneq|in|notin|ni|rightarrow|leftarrow|Rightarrow|Leftarrow|leftrightarrow|Leftrightarrow|mapsto|implies|iff|to|gets|uparrow|downarrow|lim|limsup|liminf|sin|cos|tan|sec|csc|cot|sinh|cosh|tanh|arcsin|arccos|arctan|log|ln|exp|max|min|sup|inf|det|dim|ker|gcd|deg|hom|arg|binom|dbinom|tbinom|choose|text|textrm|textbf|textit|textsf|texttt|mathrm|mathbf|mathbb|mathcal|mathfrak|mathscr|mathit|mathsf|boldsymbol|overline|underline|widehat|widetilde|overrightarrow|overleftarrow|hat|tilde|bar|vec|dot|ddot|acute|grave|check|breve|not|quad|qquad|left|right|big|Big|bigg|Bigg|langle|rangle|lceil|rceil|lfloor|rfloor|bmod|pmod|operatorname|stackrel|overset|underset|limits|nolimits|displaystyle|textstyle|scriptstyle|color|boxed|cancel|bcancel|xcancel|sout|begin|end|matrix|pmatrix|bmatrix|vmatrix|cases|array|aligned|gathered|split|substack)\b/;

  const DELIMITED_RE = /\$\$([^$]+)\$\$|\$([^$\n]+)\$|\\\((.+?)\\\)|\\\[(.+?)\\\]/g;
  const LATEX_CMD_RE_G = new RegExp(LATEX_CMD_RE.source, "g");
  const UNICODE_MATH = "→←↔⇒⇐⇔≠≤≥≈≡∼≅≢±∓∞·×÷∈∉∋⊂⊃⊆⊇⊄⊅∪∩∧∨¬∀∃∄∂∇√∑∏∐∫∬∭∮≪≫∝∅⟨⟩⌈⌉⌊⌋▶◀△▽⊕⊗⊖⊘";
  const CH_MATH_OP = new RegExp("[0-9.+\\-=<>!,:|/ " + UNICODE_MATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "]");
  const CH_ALPHA = /[a-zA-Z]/;
  const SPACE_LOOK_CMD = /^\\[a-zA-Z]/;
  const SPACE_LOOK_NUM = /^[0-9{^_]/;
  const SPACE_LOOK_VAR_CMD = /^[a-zA-Z]{1,2}\s*\\[a-zA-Z]/;
  const SPACE_LOOK_VAR_NUM = /^[a-zA-Z]{1,2}\s*[0-9+\-=<>]/;
  const WORD_BEFORE_CMD = /^[a-zA-Z]+\s*[\\{^_]/;
  const EXPAND_BACK_STOP = new RegExp("[0-9.+\\-=<>\\\\" + UNICODE_MATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "]");
  const PROXIMITY_GAP = /^[^֐-׿]*$/;
  const HAS_DOLLAR = /\$[^$]+\$/;
  const HAS_LPAREN = /\\\(/;
  const HAS_LBRACKET = /\\\[/;

  function isInsideSkip(node) {
    let el = node.parentElement;
    while (el) {
      if (el.classList && (
        el.classList.contains("katex") ||
        el.classList.contains("katex-display") ||
        el.classList.contains("katex-html") ||
        el.classList.contains("katex-mathml")
      )) return true;
      const tag = el.tagName;
      if (tag === "MJX-CONTAINER" || tag === "PRE" || tag === "CODE") return true;
      if (el.hasAttribute("data-aleph-latex-rendered")) return true;
      if (el.hasAttribute("data-aleph-math-isolated")) return true;
      el = el.parentElement;
    }
    return false;
  }

  function isMessageStreaming(msg) {
    if (PLATFORM === "chatgpt") {
      return !!(msg.closest(".result-streaming") || msg.querySelector(".result-streaming"));
    }
    return false;
  }

  function extractLatexExpression(text, cmdStart) {
    let end = cmdStart;
    const len = text.length;
    while (end < len) {
      const ch = text[end];
      if (ch === "\\") {
        let cmdEnd = end + 1;
        while (cmdEnd < len && CH_ALPHA.test(text[cmdEnd])) cmdEnd++;
        if (cmdEnd > end + 1) {
          end = cmdEnd;
          continue;
        }
        end = cmdEnd;
        continue;
      }
      if (ch === "{") {
        let depth = 1;
        end++;
        while (end < len && depth > 0) {
          if (text[end] === "{") depth++;
          else if (text[end] === "}") depth--;
          end++;
        }
        continue;
      }
      if (ch === "^" || ch === "_") { end++; continue; }
      if ((ch === "(" || ch === "[") && end > cmdStart) {
        const prev = text[end - 1];
        if (CH_ALPHA.test(prev) || prev === "}") {
          const close = ch === "(" ? ")" : "]";
          let depth = 1;
          end++;
          while (end < len && depth > 0) {
            if (text[end] === ch) depth++;
            else if (text[end] === close) depth--;
            end++;
          }
          continue;
        }
      }
      if (CH_MATH_OP.test(ch)) {
        if (ch === " ") {
          const rest = text.slice(end + 1);
          if (SPACE_LOOK_CMD.test(rest) || SPACE_LOOK_NUM.test(rest)) {
            end++;
            continue;
          }
          if (SPACE_LOOK_VAR_CMD.test(rest)) {
            end++;
            continue;
          }
          if (SPACE_LOOK_VAR_NUM.test(rest)) {
            end++;
            continue;
          }
          break;
        }
        end++;
        continue;
      }
      if (CH_ALPHA.test(ch)) {
        const rest = text.slice(end);
        if (WORD_BEFORE_CMD.test(rest)) {
          end++;
          continue;
        }
        let wordEnd = end;
        while (wordEnd < len && CH_ALPHA.test(text[wordEnd])) wordEnd++;
        const word = text.slice(end, wordEnd);
        if (word.length <= 2) {
          end = wordEnd;
          if (end < len && text[end] === ",") {
            end++;
          }
          continue;
        }
        if (wordEnd < len && (text[wordEnd] === "{" || text[wordEnd] === "^" || text[wordEnd] === "_" || text[wordEnd] === "\\")) {
          end = wordEnd;
          continue;
        }
        break;
      }
      break;
    }
    return end;
  }

  function expandBackward(text, start) {
    let s = start;
    while (s > 0) {
      const ch = text[s - 1];
      if (CH_MATH_OP.test(ch)) {
        if (ch === " " && s - 2 >= 0 && !EXPAND_BACK_STOP.test(text[s - 2]) && !CH_ALPHA.test(text[s - 2])) break;
        s--;
      } else if (CH_ALPHA.test(ch)) {
        let ws = s - 1;
        while (ws > 0 && CH_ALPHA.test(text[ws - 1])) ws--;
        if (s - ws <= 2) { s = ws; } else { break; }
      } else break;
    }
    while (s < start && text[s] === " ") s++;
    return s;
  }

  function findBareLatexRegions(text) {
    const regions = [];
    LATEX_CMD_RE_G.lastIndex = 0;
    let match;
    while ((match = LATEX_CMD_RE_G.exec(text)) !== null) {
      let start = match.index;
      let end = extractLatexExpression(text, start);
      start = expandBackward(text, start);
      const latex = text.slice(start, end).trim();
      if (latex.length <= 1) continue;
      if (/^\\\w+$/.test(latex) && /^\\(?:n|t|r|s|d|w|b|0)$/.test(latex)) continue;
      regions.push({ start, end, latex });
    }
    const merged = [];
    for (const r of regions.sort((a, b) => a.start - b.start)) {
      const last = merged[merged.length - 1];
      if (last && (r.start <= last.end ||
          (r.start - last.end <= 10 && PROXIMITY_GAP.test(text.slice(last.end, r.start))))) {
        last.end = Math.max(last.end, r.end);
        last.latex = text.slice(last.start, last.end).trim();
      } else {
        merged.push({ ...r });
      }
    }
    return merged;
  }

  const UNICODE_TO_LATEX = [
    [/→/g, "\\to "], [/←/g, "\\leftarrow "], [/↔/g, "\\leftrightarrow "],
    [/⇒/g, "\\Rightarrow "], [/⇐/g, "\\Leftarrow "], [/⇔/g, "\\Leftrightarrow "],
    [/≠/g, "\\neq "], [/≤/g, "\\leq "], [/≥/g, "\\geq "],
    [/≈/g, "\\approx "], [/≡/g, "\\equiv "], [/∼/g, "\\sim "], [/≅/g, "\\cong "],
    [/±/g, "\\pm "], [/∓/g, "\\mp "], [/∞/g, "\\infty "],
    [/·/g, "\\cdot "], [/×/g, "\\times "], [/÷/g, "\\div "],
    [/∈/g, "\\in "], [/∉/g, "\\notin "], [/∋/g, "\\ni "],
    [/⊂/g, "\\subset "], [/⊃/g, "\\supset "], [/⊆/g, "\\subseteq "], [/⊇/g, "\\supseteq "],
    [/∪/g, "\\cup "], [/∩/g, "\\cap "], [/∧/g, "\\wedge "], [/∨/g, "\\vee "],
    [/¬/g, "\\neg "], [/∀/g, "\\forall "], [/∃/g, "\\exists "],
    [/∂/g, "\\partial "], [/∇/g, "\\nabla "],
    [/∑/g, "\\sum "], [/∏/g, "\\prod "], [/∫/g, "\\int "], [/∬/g, "\\iint "], [/∭/g, "\\iiint "],
    [/√/g, "\\sqrt "],
    [/⟨/g, "\\langle "], [/⟩/g, "\\rangle "],
    [/⌈/g, "\\lceil "], [/⌉/g, "\\rceil "], [/⌊/g, "\\lfloor "], [/⌋/g, "\\rfloor "],
    [/⊕/g, "\\oplus "], [/⊗/g, "\\otimes "],
  ];

  function cleanMathText(s) {
    for (const [re, repl] of UNICODE_TO_LATEX) s = s.replace(re, repl);
    s = s.replace(/,\s*;/g, ";");
    s = s.replace(/;\s*,/g, ";");
    s = s.replace(/[.,]\s*(d[a-z])(?=[,.\s)\]}]|$)/g, "\\,$1");
    s = s.replace(/(d[a-z])\s*,\s*(d[a-z])/g, "$1\\,$2");
    return s;
  }

  function renderLatexInNode(textNode) {
    const text = textNode.textContent;
    if (!text || text.trim().length === 0) return;

    const regions = [];

    DELIMITED_RE.lastIndex = 0;
    let dm;
    while ((dm = DELIMITED_RE.exec(text)) !== null) {
      const latex = dm[1] || dm[2] || dm[3] || dm[4];
      if (HEB.test(latex)) continue;
      if (dm[2] !== undefined && !/[\\{}^_]/.test(dm[2])) continue;
      const display = !!(dm[1] || dm[4]);
      regions.push({ start: dm.index, end: dm.index + dm[0].length, latex, display });
    }

    const bare = findBareLatexRegions(text);
    for (const b of bare) {
      if (!regions.some(r => b.start < r.end && b.end > r.start)) {
        regions.push({ ...b, display: false });
      }
    }

    if (regions.length === 0) return;

    regions.sort((a, b) => a.start - b.start);
    const merged = [];
    for (const r of regions) {
      const last = merged[merged.length - 1];
      if (last && (r.start <= last.end ||
          (r.start - last.end <= 10 && PROXIMITY_GAP.test(text.slice(last.end, r.start))))) {
        last.end = Math.max(last.end, r.end);
        last.latex = text.slice(last.start, last.end);
        last.display = last.display || r.display;
      } else {
        merged.push({ start: r.start, end: r.end, latex: r.latex || text.slice(r.start, r.end), display: r.display });
      }
    }

    const wrapper = document.createElement("span");
    wrapper.setAttribute("data-aleph-latex-rendered", "true");

    let lastEnd = 0;
    for (const region of merged) {
      if (region.start > lastEnd) {
        wrapper.appendChild(document.createTextNode(text.slice(lastEnd, region.start)));
      }

      const regionText = text.slice(region.start, region.end);
      if (HEB.test(regionText)) {
        wrapper.appendChild(document.createTextNode(regionText));
        lastEnd = region.end;
        continue;
      }

      let mathText = region.latex;
      mathText = mathText.replace(/^\$\$([\s\S]*)\$\$$/, "$1");
      mathText = mathText.replace(/^\$([^$]*)\$$/, "$1");
      mathText = mathText.replace(/^\\\(([\s\S]*)\\\)$/, "$1");
      mathText = mathText.replace(/^\\\[([\s\S]*)\\\]$/, "$1");
      mathText = cleanMathText(mathText);

      const ltrSpan = document.createElement("span");
      ltrSpan.dir = "ltr";
      ltrSpan.style.unicodeBidi = "isolate";

      try {
        katex.render(mathText.trim(), ltrSpan, {
          throwOnError: true,
          displayMode: region.display,
          output: "html",
        });
      } catch (e) {
        wrapper.appendChild(document.createTextNode(regionText));
        lastEnd = region.end;
        continue;
      }

      wrapper.appendChild(ltrSpan);
      lastEnd = region.end;
    }

    if (lastEnd < text.length) {
      wrapper.appendChild(document.createTextNode(text.slice(lastEnd)));
    }

    textNode.parentNode.replaceChild(wrapper, textNode);
  }

  const MATH_PAREN_RE = /\((?=[^()]*[0-9])(?=[^()]*[=<>+\-/])[^()֐-׿]*\)/g;
  const MATH_PIPE_RE = /\|[^|֐-׿\n]{1,50}\|/g;
  const MATH_TILDE_RE = /~_?\w+/g;

  function collectRegions(re, text, regions, type) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(text)) !== null) {
      regions.push({ start: match.index, end: match.index + match[0].length, text: match[0], type });
    }
  }

  function isolateMathText(textNode) {
    const text = textNode.textContent;
    const regions = [];

    collectRegions(MATH_PAREN_RE, text, regions);
    collectRegions(MATH_PIPE_RE, text, regions);
    collectRegions(MATH_TILDE_RE, text, regions, "tilde");

    if (regions.length === 0) return;
    regions.sort((a, b) => a.start - b.start);
    const merged = [];
    for (const r of regions) {
      const last = merged[merged.length - 1];
      if (last && r.start < last.end) continue;
      merged.push(r);
    }

    const wrapper = document.createElement("span");
    wrapper.setAttribute("data-aleph-math-isolated", "true");
    let lastEnd = 0;
    for (const r of merged) {
      if (r.start > lastEnd) {
        wrapper.appendChild(document.createTextNode(text.slice(lastEnd, r.start)));
      }
      const ltrSpan = document.createElement("span");
      ltrSpan.dir = "ltr";
      ltrSpan.style.unicodeBidi = "isolate";
      if (r.type === "tilde" && typeof katex !== "undefined") {
        const sub = r.text.replace(/^~_?/, "");
        try {
          katex.render("\\sim_{" + sub + "}", ltrSpan, { throwOnError: true, displayMode: false, output: "html" });
        } catch (e) {
          ltrSpan.textContent = r.text;
        }
      } else {
        ltrSpan.textContent = r.text;
      }
      wrapper.appendChild(ltrSpan);
      lastEnd = r.end;
    }
    if (lastEnd < text.length) {
      wrapper.appendChild(document.createTextNode(text.slice(lastEnd)));
    }
    textNode.parentNode.replaceChild(wrapper, textNode);
  }

  function patchLatex() {
    if (typeof katex === "undefined" || !settings.latexFix) return;
    const messageSel = SEL.message.join(", ");
    document.querySelectorAll(messageSel).forEach((msg) => {
      if (isMessageStreaming(msg)) return;
      const walker = document.createTreeWalker(msg, NodeFilter.SHOW_TEXT);
      const latexNodes = [];
      const mathTextNodes = [];
      let node;
      while ((node = walker.nextNode())) {
        if (isInsideSkip(node)) continue;
        const txt = node.textContent;
        if (!txt || txt.trim().length === 0) continue;
        if (LATEX_CMD_RE.test(txt) || HAS_DOLLAR.test(txt) || HAS_LPAREN.test(txt) || HAS_LBRACKET.test(txt)) {
          latexNodes.push(node);
        } else if ((MATH_PAREN_RE.lastIndex = 0, MATH_PAREN_RE.test(txt)) ||
                   (MATH_PIPE_RE.lastIndex = 0, MATH_PIPE_RE.test(txt)) ||
                   (MATH_TILDE_RE.lastIndex = 0, MATH_TILDE_RE.test(txt))) {
          mathTextNodes.push(node);
        }
      }
      latexNodes.forEach(renderLatexInNode);
      mathTextNodes.forEach(isolateMathText);
    });
  }

  // ── Style Injector ─────────────────────────────────────────────────────
  const STYLE_ID = "aleph-dynamic-styles";

  function buildThemeSelector(base, selectors) {
    return selectors.map(s => `[data-aleph-theme] ${s.trim()}`).join(",\n");
  }

  function applyStyles() {
    if (!isPlatformEnabled()) {
      const existing = document.getElementById(STYLE_ID);
      if (existing) existing.remove();
      document.documentElement.removeAttribute("data-aleph-theme");
      document.documentElement.removeAttribute("data-aleph-focus");
      document.documentElement.removeAttribute("data-aleph-stream-enabled");
      document.documentElement.removeAttribute("data-aleph-stream-anim");
      updateColorScheme(null);
      return;
    }

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

  // ── Observer (scoped to relevant mutations) ────────────────────────────
  let timer = null;
  function scheduleUpdate() {
    if (patching) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(patchAll, 120);
  }

  new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.target === document.head || m.target.closest?.("head")) continue;
      if (m.target.id === STYLE_ID) continue;
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
    setInterval(patchAll, 3000);
  });

  console.log(
    `%c[Aleph v${VERSION}] loaded on ${PLATFORM}`,
    "color:#4ade80;font-weight:bold;font-size:14px"
  );
})();
