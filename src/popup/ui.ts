import { DEFAULTS } from "../shared/defaults";
import { detectPlatform, platformThemeKey, type Platform } from "../shared/platform";
import { PLATFORM_LABELS } from "../shared/platformMeta";

function save(key: string, value: unknown) {
  chrome.storage.sync.set({ [key]: value });
}

// Theme grid
let themeApplyLocal = false;
let detectedPlatform: Platform | null = null;

function initThemeGrid(currentTheme: string) {
  const grid = document.getElementById("themeGrid")!;
  grid.querySelectorAll(".theme-swatch").forEach((btn) => {
    const t = btn.getAttribute("data-theme");
    btn.classList.toggle("active", t === currentTheme);
    btn.addEventListener("click", () => {
      grid.querySelectorAll(".theme-swatch").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      if (themeApplyLocal && detectedPlatform) {
        save(platformThemeKey(detectedPlatform), t === "none" ? "" : t);
      } else {
        save("theme", t);
      }
    });
  });
}

export function detectActivePlatform() {
  chrome.tabs?.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs?.[0]?.url) return;
    const platform = detectPlatform(tabs[0].url);
    if (!platform) return;
    detectedPlatform = platform;

    const row = document.getElementById("themePlatformRow");
    const nameEl = document.getElementById("currentPlatformName");
    if (row && nameEl) {
      nameEl.textContent = PLATFORM_LABELS[platform];
      row.style.display = "";
    }
  });
}

// Platform chips
function initPlatformChips(settings: Record<string, any>) {
  document.querySelectorAll("#platformChips .chip").forEach((chip) => {
    const key = chip.getAttribute("data-key")!;
    chip.classList.toggle("active", settings[key]);
    chip.addEventListener("click", () => {
      const newVal = !chip.classList.contains("active");
      chip.classList.toggle("active", newVal);
      save(key, newVal);
    });
  });
}

// Load settings into UI
export function loadUI() {
  chrome.storage.sync.get(DEFAULTS, (s) => {
    (document.getElementById("focusMode") as HTMLInputElement).checked = s.focusMode;
    (document.getElementById("miniGame") as HTMLInputElement).checked = s.miniGame;
    (document.getElementById("fontFamily") as HTMLSelectElement).value = s.fontFamily;

    const fsInput = document.getElementById("fontSize") as HTMLInputElement;
    const fsOutput = document.getElementById("fontSizeVal")!;
    fsInput.value = s.fontSize;
    fsOutput.textContent = s.fontSize == 0 ? "default" : `${s.fontSize}px`;

    initThemeGrid(s.theme || "none");
    initPlatformChips(s);
  });
}

// Export / Import
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

function importSettings(file: File) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      // Imported settings are user-supplied JSON — filtered against DEFAULTS.
      const data = JSON.parse(String(reader.result));
      const filtered: Record<string, unknown> = {};
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

// Bind events
export function bindEvents() {
  document.getElementById("focusMode")!.addEventListener("change", (e) => {
    save("focusMode", (e.target as HTMLInputElement).checked);
  });

  document.getElementById("miniGame")!.addEventListener("change", (e) => {
    save("miniGame", (e.target as HTMLInputElement).checked);
  });

  document.getElementById("fontFamily")!.addEventListener("change", (e) => {
    save("fontFamily", (e.target as HTMLSelectElement).value);
  });

  const fsInput = document.getElementById("fontSize") as HTMLInputElement;
  const fsOutput = document.getElementById("fontSizeVal")!;
  fsInput.addEventListener("input", () => {
    fsOutput.textContent = Number(fsInput.value) === 0 ? "default" : `${fsInput.value}px`;
  });
  fsInput.addEventListener("change", () => {
    save("fontSize", parseFloat(fsInput.value));
  });

  document.getElementById("themeApplyLocal")?.addEventListener("change", (e) => {
    themeApplyLocal = (e.target as HTMLInputElement).checked;
  });

  const openSettings = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("dist/settings.html") });
  };
  document.getElementById("settingsBtn")!.addEventListener("click", openSettings);
  document.getElementById("settingsBtn2")!.addEventListener("click", openSettings);

  document.getElementById("dashboardBtn")!.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("dist/insights.html") });
  });

  document.getElementById("exportBtn")!.addEventListener("click", exportSettings);
  document.getElementById("importBtn")!.addEventListener("click", () => {
    document.getElementById("importFile")!.click();
  });
  document.getElementById("importFile")!.addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      importSettings(file);
      input.value = "";
    }
  });

  // Cloud sync (front-view sign-in) — reuses the aleph-sync-* messages.
  const signInBtn = document.getElementById("syncSignInBtn") as HTMLButtonElement | null;
  const setSignInLabel = (text: string) => {
    const label = signInBtn?.querySelector(".sync-label");
    if (label) label.textContent = text;
  };
  signInBtn?.addEventListener("click", () => {
    signInBtn.disabled = true;
    setSignInLabel("Signing in…");
    chrome.runtime.sendMessage({ type: "aleph-sync-signin" }, (resp) => {
      signInBtn.disabled = false;
      setSignInLabel("Sign in with Google");
      if (resp?.success) { loadSyncIndicator(); return; }
      setSignInLabel("Sign-in failed — retry");
      setTimeout(() => setSignInLabel("Sign in with Google"), 2500);
    });
  });
}

// Cloud sync (front-view sign-in). Auth state is raw JSON from the background —
// boundary `any`. Signed out → the "Sign in with Google" bar; signed in → just
// the header cloud glyph (sign-out lives on the settings page).
function renderSyncState(state: any) {
  const syncBar = document.getElementById("syncBar");
  const cloud = document.getElementById("syncIndicator");
  const isSignedIn = Boolean(state?.signedIn);
  if (syncBar) syncBar.style.display = isSignedIn ? "none" : "";
  if (cloud) {
    cloud.style.display = isSignedIn ? "" : "none";
    // Custom CSS tooltip (data-tooltip) — the native `title` tooltip is
    // unreliable in the popup. Rendered by .sync-indicator[data-tooltip] in popup.css.
    cloud.dataset.tooltip = isSignedIn && state.email ? "Cloud sync · " + state.email : "Cloud sync active";
  }
}

export function loadSyncIndicator() {
  chrome.runtime.sendMessage({ type: "aleph-sync-status" }, renderSyncState);
}
