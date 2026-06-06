import { DEFAULTS } from "../shared/defaults";
import { THEME_NAMES } from "../shared/themes";

(function () {
  "use strict";

  const CHECKBOXES = [
    "bidiEnabled", "enableClaude", "enableChatgpt", "enableGemini",
    "focusHideUpgrade", "focusHideChips", "focusHidePromos",
    "latexFix", "streamSmooth",
  ];

  const SELECTS = [
    "codeFontFamily", "streamAnimation",
    "themeClaude", "themeChatgpt", "themeGemini",
  ];

  const RANGES = [
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

  function updateStreamAnimVisibility(streamEnabled) {
    const field = document.getElementById("streamAnimField");
    if (field) field.style.display = streamEnabled ? "" : "none";
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
      updateStreamAnimVisibility(s.streamSmooth);
    });
  }

  // ── Bind events ────────────────────────────────────────────────────
  function bindEvents() {
    CHECKBOXES.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("change", (e) => {
        save(id, e.target.checked);
        if (id === "streamSmooth") updateStreamAnimVisibility(e.target.checked);
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

    document.getElementById("backLink").addEventListener("click", (e) => {
      e.preventDefault();
      window.close();
    });
  }

  // ── Cloud Sync UI ────────────────────────────────────────
  function updateSyncUI(state) {
    const signedOut = document.getElementById("syncSignedOut");
    const signedIn = document.getElementById("syncSignedIn");
    if (!signedOut || !signedIn) return;
    if (state && state.signedIn) {
      signedOut.style.display = "none";
      signedIn.style.display = "";
      document.getElementById("syncEmail").textContent = state.email || "unknown";
      const lastTime = document.getElementById("syncLastTime");
      if (state.lastSyncAt) {
        lastTime.textContent = "Last sync: " + new Date(state.lastSyncAt).toLocaleString();
      } else {
        lastTime.textContent = "Last sync: never";
      }
    } else {
      signedOut.style.display = "";
      signedIn.style.display = "none";
    }
  }

  function loadSyncStatus() {
    chrome.runtime.sendMessage({ type: "aleph-sync-status" }, updateSyncUI);
  }

  function bindSyncEvents() {
    document.getElementById("syncSignInBtn")?.addEventListener("click", () => {
      const btn = document.getElementById("syncSignInBtn");
      btn.textContent = "Signing in...";
      btn.disabled = true;
      chrome.runtime.sendMessage({ type: "aleph-sync-signin" }, (resp) => {
        btn.textContent = "Sign in with Google";
        btn.disabled = false;
        if (resp?.success) loadSyncStatus();
        else alert("Sign-in failed: " + (resp?.error || "Unknown error"));
      });
    });

    document.getElementById("syncSignOutBtn")?.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "aleph-sync-signout" }, () => loadSyncStatus());
    });


  }

  document.addEventListener("DOMContentLoaded", () => {
    loadUI();
    bindEvents();
    loadSyncStatus();
    bindSyncEvents();
  });
})();
