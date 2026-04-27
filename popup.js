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
    themeClaude: "",
    themeChatgpt: "",
    themeGemini: "",
    focusMode: false,
    focusHideUpgrade: true,
    focusHideChips: true,
    focusHidePromos: true,
    streamSmooth: true,
    streamAnimation: "platform",
    messageSpacing: 0,
  };

  const THEME_NAMES = {
    none: "Default",
    warmDark: "Warm Dark",
    coolDark: "Cool Dark",
    paperLight: "Paper Light",
    highContrast: "High Contrast",
    midnight: "Midnight",
    nord: "Nord",
    dracula: "Dracula",
    solarized: "Solarized",
    rosePine: "Rosé Pine",
    catppuccin: "Catppuccin",
  };

  const CHECKBOXES = [
    "bidiEnabled", "enableClaude", "enableChatgpt", "enableGemini",
    "focusMode", "streamSmooth",
    "focusHideUpgrade", "focusHideChips", "focusHidePromos",
  ];
  const SELECTS = ["fontFamily", "codeFontFamily", "streamAnimation", "themeClaude", "themeChatgpt", "themeGemini"];
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

  // ── Populate per-platform theme dropdowns ──────────────────────────
  function populateThemeSelects() {
    ["themeClaude", "themeChatgpt", "themeGemini"].forEach(id => {
      const sel = document.getElementById(id);
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

  function updateFocusCategoriesVisibility(focusEnabled) {
    const cats = document.getElementById("focusCategories");
    if (cats) cats.style.display = focusEnabled ? "" : "none";
  }

  // ── Load settings into UI ──────────────────────────────────────────
  function loadUI() {
    populateThemeSelects();
    chrome.storage.sync.get(DEFAULTS, (s) => {
      CHECKBOXES.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.checked = s[id];
      });
      SELECTS.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = s[id];
      });
      RANGES.forEach(({ id, outputId, fmt }) => {
        const input = document.getElementById(id);
        const output = document.getElementById(outputId);
        if (input && output) {
          input.value = s[id];
          output.textContent = fmt(parseFloat(s[id]));
        }
      });
      initThemeGrid(s.theme || "none");
      updateStreamAnimVisibility(s.streamSmooth);
      updateFocusCategoriesVisibility(s.focusMode);
    });
  }

  // ── Export / Import ────────────────────────────────────────────────
  function exportSettings() {
    chrome.storage.sync.get(null, (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "aleph-settings.json";
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  function importSettings(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        const filtered = {};
        for (const key of Object.keys(DEFAULTS)) {
          if (key in data) filtered[key] = data[key];
        }
        chrome.storage.sync.set(filtered, () => loadUI());
      } catch (err) {
        console.error("[Aleph] Import failed:", err);
      }
    };
    reader.readAsText(file);
  }

  // ── Bind events ────────────────────────────────────────────────────
  function bindEvents() {
    CHECKBOXES.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("change", (e) => {
        save(id, e.target.checked);
        if (id === "streamSmooth") updateStreamAnimVisibility(e.target.checked);
        if (id === "focusMode") updateFocusCategoriesVisibility(e.target.checked);
      });
    });

    SELECTS.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("change", (e) => {
        save(id, e.target.value);
      });
    });

    RANGES.forEach(({ id, outputId, fmt }) => {
      const input = document.getElementById(id);
      const output = document.getElementById(outputId);
      if (!input || !output) return;
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

    document.getElementById("exportBtn").addEventListener("click", exportSettings);

    document.getElementById("importBtn").addEventListener("click", () => {
      document.getElementById("importFile").click();
    });

    document.getElementById("importFile").addEventListener("change", (e) => {
      if (e.target.files[0]) {
        importSettings(e.target.files[0]);
        e.target.value = "";
      }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    loadUI();
    bindEvents();
  });
})();
