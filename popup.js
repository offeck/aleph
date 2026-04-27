(function () {
  "use strict";

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
    focusMode: false,
    streamSmooth: true,
    streamAnimation: "fadeIn",
    messageSpacing: 0,
  };

  const CHECKBOXES = ["bidiEnabled", "enableClaude", "enableChatgpt", "enableGemini", "focusMode", "streamSmooth"];
  const SELECTS = ["fontFamily", "codeFontFamily", "streamAnimation"];
  const RANGES = [
    { id: "fontSize",         outputId: "fontSizeVal",         fmt: v => v == 0 ? "default" : `${v}px` },
    { id: "lineHeight",       outputId: "lineHeightVal",       fmt: v => v == 0 ? "default" : v.toFixed(1) },
    { id: "paragraphSpacing", outputId: "paragraphSpacingVal", fmt: v => v == 0 ? "default" : `${v}px` },
    { id: "codeFontSize",     outputId: "codeFontSizeVal",     fmt: v => v == 0 ? "default" : `${v}px` },
    { id: "chatWidth",        outputId: "chatWidthVal",        fmt: v => v == 0 ? "default" : `${v}px` },
    { id: "messageSpacing",   outputId: "messageSpacingVal",   fmt: v => v == 0 ? "default" : `${v}px` },
  ];

  function save(key, value) {
    chrome.storage.sync.set({ [key]: value });
  }

  // ── Theme grid ─────────────────────────────────────────────────────
  function initThemeGrid(currentTheme) {
    const grid = document.getElementById("themeGrid");
    grid.querySelectorAll(".theme-swatch").forEach(btn => {
      const t = btn.getAttribute("data-theme");
      btn.classList.toggle("active", t === currentTheme);
      btn.addEventListener("click", () => {
        grid.querySelectorAll(".theme-swatch").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        save("theme", t);
      });
    });
  }

  function updateStreamAnimVisibility(streamEnabled) {
    const field = document.getElementById("streamAnimField");
    if (field) field.style.display = streamEnabled ? "" : "none";
  }

  // ── Load settings into UI ──────────────────────────────────────────
  function loadUI() {
    chrome.storage.sync.get(DEFAULTS, (s) => {
      CHECKBOXES.forEach(id => {
        document.getElementById(id).checked = s[id];
      });
      SELECTS.forEach(id => {
        document.getElementById(id).value = s[id];
      });
      RANGES.forEach(({ id, outputId, fmt }) => {
        const input = document.getElementById(id);
        const output = document.getElementById(outputId);
        input.value = s[id];
        output.textContent = fmt(parseFloat(s[id]));
      });
      initThemeGrid(s.theme || "none");
      updateStreamAnimVisibility(s.streamSmooth);
    });
  }

  // ── Bind events ────────────────────────────────────────────────────
  function bindEvents() {
    CHECKBOXES.forEach(id => {
      document.getElementById(id).addEventListener("change", (e) => {
        save(id, e.target.checked);
        if (id === "streamSmooth") updateStreamAnimVisibility(e.target.checked);
      });
    });

    SELECTS.forEach(id => {
      document.getElementById(id).addEventListener("change", (e) => {
        save(id, e.target.value);
      });
    });

    RANGES.forEach(({ id, outputId, fmt }) => {
      const input = document.getElementById(id);
      const output = document.getElementById(outputId);
      input.addEventListener("input", () => {
        output.textContent = fmt(parseFloat(input.value));
      });
      input.addEventListener("change", () => {
        save(id, parseFloat(input.value));
      });
    });

    document.getElementById("resetBtn").addEventListener("click", () => {
      chrome.storage.sync.set(DEFAULTS, () => loadUI());
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    loadUI();
    bindEvents();
  });
})();
